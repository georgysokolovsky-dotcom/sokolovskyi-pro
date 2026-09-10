export const WEBINAR_PLAYER_ACTIONS = Object.freeze(['play', 'heartbeat', 'pause', 'seek', 'ended']);
export const WEBINAR_MILESTONES = Object.freeze([25, 50, 75, 90, 100]);

export function mergeWatchedSeconds(segments, durationSeconds) {
  const normalized = segments
    .map(({ start, end }) => ({ start: Math.max(0, Number(start)), end: Math.min(durationSeconds, Number(end)) }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let watched = 0;
  let current = null;
  for (const segment of normalized) {
    if (!current) current = { ...segment };
    else if (segment.start <= current.end) current.end = Math.max(current.end, segment.end);
    else {
      watched += current.end - current.start;
      current = { ...segment };
    }
  }
  if (current) watched += current.end - current.start;
  return Math.min(durationSeconds, watched);
}

export function summarizeWebinarProgress({ segments, durationSeconds, started, endedNearFinish = false }) {
  let watchedSeconds = mergeWatchedSeconds(segments, durationSeconds);
  let progressPercent = durationSeconds > 0 ? Math.min(100, (watchedSeconds / durationSeconds) * 100) : 0;
  if (endedNearFinish && progressPercent >= 95) {
    watchedSeconds = durationSeconds;
    progressPercent = 100;
  }
  return {
    started: Boolean(started),
    watchedSeconds,
    progressPercent,
    milestones: WEBINAR_MILESTONES.filter((threshold) => progressPercent + 0.0001 >= threshold),
  };
}

export function acceptedWatchSegment({ session, action, positionSeconds, observedAt, toleranceSeconds, maxGapSeconds }) {
  if (!session.playing || !['heartbeat', 'pause', 'ended'].includes(action)) return null;
  const start = Number(session.lastPositionSeconds);
  const end = Number(positionSeconds);
  const advance = end - start;
  const elapsed = Math.max(0, (new Date(observedAt).getTime() - new Date(session.lastObservedAt).getTime()) / 1000);
  const allowedAdvance = Math.min(maxGapSeconds, elapsed + toleranceSeconds);
  if (!Number.isFinite(advance) || advance <= 0 || advance > allowedAdvance + 0.0001) return null;
  return { start, end };
}
