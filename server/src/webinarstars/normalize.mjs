const scalar = (value) => value == null ? null : String(value);
const array = (value) => Array.isArray(value) ? value : [];
const first = (...values) => values.find((value) => value != null) ?? null;
const iso = (value) => {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

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

export function normalizeReports(payload) {
  return payloadArray(payload, ['reports', 'items']).map((item) => ({
    reportId: scalar(first(item.report_id, item.report, item.id)),
    webinarId: scalar(first(item.webinar_id, item.webinar, item.webinarId)),
    scheduledStart: iso(first(item.date_start, item.start_at, item.started_at, item.start)),
    scheduledEnd: iso(first(item.date_end, item.end_at, item.ended_at, item.end)),
  })).filter((item) => item.reportId && item.webinarId);
}

export function selectReportForSession(reports, session, { toleranceMs = 10 * 60 * 1000 } = {}) {
  const targetStart = new Date(session.scheduledStart).getTime();
  const targetEnd = new Date(session.scheduledEnd).getTime();
  const candidates = reports.filter((report) => {
    if (String(report.webinarId) !== String(session.webinarId) || !report.scheduledStart || !report.scheduledEnd) return false;
    return Math.abs(new Date(report.scheduledStart).getTime() - targetStart) <= toleranceMs
      && Math.abs(new Date(report.scheduledEnd).getTime() - targetEnd) <= toleranceMs;
  });
  if (candidates.length > 1) throw new Error('ambiguous_webinarstars_report');
  return candidates[0] ?? null;
}

function normalizeButton(button) {
  const statusValue = String(first(button?.status, 'unseen')).toLowerCase();
  const status = ['unseen', 'seen', 'clicked'].includes(statusValue) ? statusValue : 'unseen';
  return { type: scalar(button?.type), showNumber: scalar(first(button?.show_number, button?.showNumber)), status };
}

export function normalizeReport(payload) {
  const root = payload?.report && typeof payload.report === 'object' && !Array.isArray(payload.report) ? payload.report
    : payload?.data && !Array.isArray(payload.data) ? payload.data : payload?.result && !Array.isArray(payload.result) ? payload.result : payload;
  const reportId = scalar(first(root?.report_id, root?.id));
  const webinarId = scalar(first(root?.webinar_id, root?.webinar, root?.webinarId));
  const visitors = payloadArray(root, ['visitors', 'users', 'participants']).map((visitor) => {
    const presenceStarted = iso(first(visitor.date_start, visitor.started_at, visitor.start));
    const presenceEnded = iso(first(visitor.date_end, visitor.ended_at, visitor.end));
    const presenceSeconds = presenceStarted && presenceEnded
      ? Math.max(0, Math.floor((new Date(presenceEnded) - new Date(presenceStarted)) / 1000)) : null;
    return {
      visitorId: scalar(first(visitor.visitor_id, visitor.id, visitor.unique)),
      rawUtm: typeof visitor.utm === 'string' ? visitor.utm : null,
      presenceStarted, presenceEnded, presenceSeconds,
      buttons: array(first(visitor.buttons_info, visitor.buttons)).map(normalizeButton),
      commentCount: array(visitor.comments).length,
    };
  }).filter((visitor) => visitor.visitorId);
  return { reportId, webinarId, visitors };
}

export function classifyVisitor(visitor, session, policy) {
  const durationSeconds = Math.max(1, Math.floor((new Date(session.scheduledEnd) - new Date(session.scheduledStart)) / 1000));
  const presenceRatio = visitor.presenceSeconds == null ? null : Math.min(1, visitor.presenceSeconds / durationSeconds);
  const targetButtons = visitor.buttons.filter((button) => policy.targetCtaShowNumbers.includes(String(button.showNumber)));
  return {
    attended: Boolean(visitor.presenceStarted),
    presenceStarted: visitor.presenceStarted,
    presenceEnded: visitor.presenceEnded,
    presenceSeconds: visitor.presenceSeconds,
    presenceRatio,
    buttons: visitor.buttons,
    targetCtaSeen: targetButtons.some((button) => ['seen', 'clicked'].includes(button.status)),
    targetCtaClicked: targetButtons.some((button) => button.status === 'clicked'),
    commentPresent: visitor.commentCount > 0,
    commentCount: visitor.commentCount,
  };
}
