const scalar = (value) => value == null ? null : String(value);
const array = (value) => Array.isArray(value) ? value : [];
const first = (...values) => values.find((value) => value != null) ?? null;
const wallTimePattern = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;
const formatters = new Map();

function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return formatters.get(timeZone);
}

function localParts(instant, formatter) {
  const values = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type))
    .map((part) => [part.type, Number(part.value)]));
  return [values.year, values.month, values.day, values.hour, values.minute, values.second];
}

export function normalizeProviderTimestamp(value, timeZone = null) {
  if (typeof value !== 'string') return null;
  const wall = value.match(wallTimePattern);
  if (!wall) {
    if (!instantPattern.test(value)) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (!timeZone) return null;
  let formatter;
  try { formatter = formatterFor(timeZone); } catch { return null; }
  const parts = wall.slice(1).map(Number);
  const wallUtc = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  if (!Number.isFinite(wallUtc) || new Date(wallUtc).toISOString().slice(0, 19) !== `${wall[1]}-${wall[2]}-${wall[3]}T${wall[4]}:${wall[5]}:${wall[6]}`) return null;
  const candidates = new Set();
  for (const hours of [-24, 0, 24]) {
    const sampled = wallUtc + hours * 60 * 60 * 1000;
    const local = localParts(sampled, formatter);
    const offset = Date.UTC(local[0], local[1] - 1, local[2], local[3], local[4], local[5]) - sampled;
    const candidate = wallUtc - offset;
    if (localParts(candidate, formatter).every((part, index) => part === parts[index])) candidates.add(candidate);
  }
  return candidates.size === 1 ? new Date([...candidates][0]).toISOString() : null;
}

function payloadArray(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  for (const key of ['data', 'result']) {
    const nested = payload?.[key];
    if (Array.isArray(nested)) return nested;
    if (nested && typeof nested === 'object') for (const candidate of keys) if (Array.isArray(nested[candidate])) return nested[candidate];
  }
  return [];
}

export function normalizeReports(payload, { timeZone = null } = {}) {
  return payloadArray(payload, ['reports', 'items']).map((item) => ({
    reportId: scalar(first(item.report_id, item.report, item.id)),
    webinarId: scalar(first(item.webinar_id, item.webinar, item.webinarId)),
    scheduledStart: normalizeProviderTimestamp(first(item.date_start, item.start_at, item.started_at, item.start), timeZone),
    scheduledEnd: normalizeProviderTimestamp(first(item.date_end, item.end_at, item.ended_at, item.end), timeZone),
  })).filter((item) => item.reportId && item.webinarId);
}

export function selectReportForSession(reports, session) {
  const targetStart = new Date(session.scheduledStart).getTime();
  const targetEnd = new Date(session.scheduledEnd).getTime();
  const candidates = reports.filter((report) => {
    if (String(report.webinarId) !== String(session.webinarId) || !report.scheduledStart || !report.scheduledEnd) return false;
    return new Date(report.scheduledStart).getTime() === targetStart
      && new Date(report.scheduledEnd).getTime() === targetEnd;
  });
  if (candidates.length > 1) throw new Error('ambiguous_webinarstars_report');
  return candidates[0] ?? null;
}

function normalizeButton(button) {
  const statusValue = String(first(button?.status, 'unseen')).toLowerCase();
  const status = ['unseen', 'seen', 'clicked'].includes(statusValue) ? statusValue : 'unseen';
  return { type: scalar(button?.type), showNumber: scalar(first(button?.show_number, button?.showNumber)), status };
}

export function normalizeReport(payload, { timeZone = null } = {}) {
  const root = payload?.report && typeof payload.report === 'object' && !Array.isArray(payload.report) ? payload.report
    : payload?.data && !Array.isArray(payload.data) ? payload.data : payload?.result && !Array.isArray(payload.result) ? payload.result : payload;
  const reportId = scalar(first(root?.report_id, root?.id));
  const webinarId = scalar(first(root?.webinar_id, root?.webinar, root?.webinarId));
  const visitors = payloadArray(root, ['visitors', 'users', 'participants']).map((visitor) => {
    const presenceStarted = normalizeProviderTimestamp(first(visitor.date_start, visitor.started_at, visitor.start), timeZone);
    const presenceEnded = normalizeProviderTimestamp(first(visitor.date_end, visitor.ended_at, visitor.end), timeZone);
    const presenceSeconds = presenceStarted && presenceEnded && new Date(presenceEnded) >= new Date(presenceStarted)
      ? Math.floor((new Date(presenceEnded) - new Date(presenceStarted)) / 1000) : null;
    return {
      visitorId: scalar(first(visitor.visitor_id, visitor.id, visitor.unique)),
      rawUtm: typeof visitor.utm === 'string' ? visitor.utm : null,
      presenceStarted, presenceEnded, presenceSeconds,
      buttons: array(first(visitor.buttons_info, visitor.buttons)).map(normalizeButton),
      commentCount: array(visitor.comments).length,
    };
  }).filter((visitor) => visitor.visitorId);
  return {
    reportId, webinarId,
    scheduledStart: normalizeProviderTimestamp(first(root?.date_start, root?.start_at, root?.started_at, root?.start), timeZone),
    scheduledEnd: normalizeProviderTimestamp(first(root?.date_end, root?.end_at, root?.ended_at, root?.end), timeZone),
    visitors,
  };
}

export function classifyVisitor(visitor, session, policy) {
  const sessionStart = new Date(session.scheduledStart).getTime();
  const sessionEnd = new Date(session.scheduledEnd).getTime();
  const durationSeconds = Math.floor((sessionEnd - sessionStart) / 1000);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('invalid_provider_session_interval');
  const presenceRatio = visitor.presenceSeconds == null ? null : Math.min(1, visitor.presenceSeconds / durationSeconds);
  const visitorStart = visitor.presenceStarted ? new Date(visitor.presenceStarted).getTime() : NaN;
  const visitorEnd = visitor.presenceEnded ? new Date(visitor.presenceEnded).getTime() : NaN;
  const timingValid = Number.isFinite(visitorStart) && Number.isFinite(visitorEnd)
    && visitorEnd >= visitorStart && visitor.presenceSeconds != null;
  const effectivePresenceSeconds = timingValid
    ? Math.max(0, Math.floor((Math.min(visitorEnd, sessionEnd) - Math.max(visitorStart, sessionStart)) / 1000))
    : null;
  const effectivePresenceRatio = effectivePresenceSeconds == null ? null : Math.min(1, effectivePresenceSeconds / durationSeconds);
  const targetButtons = visitor.buttons.filter((button) => policy.targetCtaShowNumbers.includes(String(button.showNumber)));
  return {
    attended: Boolean(visitor.presenceStarted),
    presenceStarted: visitor.presenceStarted,
    presenceEnded: visitor.presenceEnded,
    presenceSeconds: visitor.presenceSeconds,
    presenceRatio,
    effectivePresenceSeconds,
    effectivePresenceRatio,
    timingValid,
    buttons: visitor.buttons,
    targetCtaSeen: targetButtons.some((button) => ['seen', 'clicked'].includes(button.status)),
    targetCtaClicked: targetButtons.some((button) => button.status === 'clicked'),
    commentPresent: visitor.commentCount > 0,
    commentCount: visitor.commentCount,
  };
}
