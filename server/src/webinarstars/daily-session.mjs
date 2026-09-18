const dayFormatter = (timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(date, formatter) {
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
}

function localStartUtc(day, formatter, hour, minute) {
  const wallUtc = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  const matches = [];
  // IANA offsets can include half-hour increments. No fixed Kyiv UTC offset is assumed.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(wallUtc - offsetMinutes * 60_000);
    const local = parts(candidate, formatter);
    if (local.year === day.year && local.month === day.month && local.day === day.day
      && local.hour === hour && local.minute === minute) matches.push(candidate);
  }
  if (matches.length !== 1) throw new Error('Ambiguous or nonexistent WebinarStars local session time');
  return matches[0];
}

export function resolveDailyWebinarStarsSession(now, { timeZone, localStart = '19:00', durationMinutes = 91 } = {}) {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid session resolution time');
  const match = /^(\d{2}):(\d{2})$/.exec(localStart);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || !Number.isInteger(durationMinutes) || durationMinutes < 1) {
    throw new Error('Invalid daily WebinarStars schedule');
  }
  const formatter = dayFormatter(timeZone);
  const today = parts(instant, formatter);
  let start = localStartUtc(today, formatter, Number(match[1]), Number(match[2]));
  if (instant >= start) {
    const nextDay = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    start = localStartUtc({ year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() },
      formatter, Number(match[1]), Number(match[2]));
  }
  return { scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + durationMinutes * 60_000).toISOString() };
}
