import { randomUUID } from 'node:crypto';
import { createCorrelationHmac, parseCorrelationToken } from './correlation.mjs';
import { classifyVisitor, normalizeReport, normalizeReports, selectReportForSession } from './normalize.mjs';

const provider = 'webinarstars';

function nextPollAt(session, offsets, now) {
  const nextIndex = session.attemptIndex + 1;
  if (nextIndex >= offsets.length) return null;
  return new Date(new Date(session.scheduledEnd).getTime() + offsets[nextIndex] * 60_000).toISOString();
}

function safeLog(logger, event, details = {}) {
  if (typeof logger?.info === 'function') logger.info({ event, ...details });
}

export function createWebinarStarsSyncScheduler({ store, client, config, lifecycle = null, now = () => new Date(), workerId = `webinarstars-${randomUUID()}`, leaseMs = 30_000, logger = null } = {}) {
  if (!store || !client || !config) throw new Error('WebinarStars sync scheduler dependencies are required');

  async function recordVisitor(session, report, visitor) {
    const token = parseCorrelationToken(visitor.rawUtm);
    const correlation = token
      ? await store.findProviderCorrelation({ provider, correlationHmac: createCorrelationHmac(token, config.correlationSecret) })
      : null;
    const signals = classifyVisitor(visitor, session, config);
    if (correlation && !signals.timingValid) throw new Error('invalid_provider_presence_interval');
    const saved = await store.ingestProviderVisitor({
      provider, sessionId: session.id, reportId: report.reportId, visitorId: visitor.visitorId,
      userId: correlation?.userId ?? null, funnelId: session.funnelId,
      correlationStatus: correlation ? 'matched' : 'unmatched', signals,
    });
    if (saved.duplicate || !correlation) return { duplicate: saved.duplicate, matched: Boolean(correlation) };
    const base = `${provider}:${report.reportId}:${visitor.visitorId}`;
    const events = [
      ['webinarstars_report_finalized', {}],
      ...(signals.attended ? [['webinarstars_attended', {}]] : []),
      ...(signals.presenceStarted ? [['webinarstars_presence_started', { provider_timestamp: signals.presenceStarted }]] : []),
      ...(signals.presenceEnded ? [['webinarstars_presence_ended', { provider_timestamp: signals.presenceEnded }]] : []),
      ...(signals.presenceSeconds != null ? [['webinarstars_presence_seconds', { presence_seconds: signals.presenceSeconds, presence_ratio: signals.presenceRatio }]] : []),
      ...(signals.targetCtaSeen ? [['webinarstars_cta_seen', {}]] : []),
      ...(signals.targetCtaClicked ? [['webinarstars_cta_clicked', {}]] : []),
      ...(signals.commentPresent ? [['webinarstars_comment_present', { comment_count: signals.commentCount }]] : []),
    ];
    for (const [eventType, metadata] of events) await store.addEvent({
      userId: correlation.userId, funnelId: session.funnelId, eventType,
      metadata: { provider, report_id: report.reportId, visitor_id: visitor.visitorId, ...metadata },
      idempotencyKey: `${base}:${eventType}`,
    });
    return { duplicate: false, matched: true };
  }

  async function execute(session) {
    const reports = normalizeReports(await client.getReports(), { timeZone: config.timeZone });
    let selected;
    try { selected = selectReportForSession(reports, session); }
    catch {
      return { status: 'permanent_failure', errorCode: 'ambiguous_report', errorCategory: 'permanent' };
    }
    if (!selected) return { status: 'retry', errorCode: 'report_not_found', errorCategory: 'retryable' };
    const report = normalizeReport(await client.getReport(selected.reportId), { timeZone: config.timeZone });
    if (!report.reportId) report.reportId = selected.reportId;
    if (String(report.webinarId) !== String(session.webinarId) || report.reportId !== selected.reportId
      || report.scheduledStart !== new Date(session.scheduledStart).toISOString()
      || report.scheduledEnd !== new Date(session.scheduledEnd).toISOString()) {
      return { status: 'permanent_failure', errorCode: 'report_session_mismatch', errorCategory: 'permanent' };
    }
    let matched = 0;
    let unmatched = 0;
    for (const visitor of report.visitors) {
      const result = await recordVisitor(session, report, visitor);
      if (result.matched) matched += 1; else unmatched += 1;
    }
    return { status: report.visitors.length ? 'completed' : 'retry', reportId: report.reportId, matched, unmatched };
  }

  async function run({ limit = 25 } = {}) {
    const result = { workerId, claimed: 0, completed: 0, retried: 0, finalizationPending: 0, failed: 0, matched: 0, unmatched: 0 };
    while (result.claimed < limit) {
      const current = now();
      const session = await store.claimProviderSyncSession({ provider, workerId, leaseMs, now: current.toISOString() });
      if (!session) break;
      result.claimed += 1;
      try {
        const outcome = await execute(session);
        result.matched += outcome.matched ?? 0;
        result.unmatched += outcome.unmatched ?? 0;
        if (outcome.status === 'completed') {
          await lifecycle?.finalizeReport({ session, reportId: outcome.reportId, finalizedAt: current.toISOString() });
          await store.finishProviderSyncAttempt({ sessionId: session.id, workerId, status: 'completed', reportId: outcome.reportId });
          result.completed += 1;
        } else if (outcome.status === 'retry') {
          const next = nextPollAt(session, config.pollOffsetsMinutes, current);
          if (next) {
            await store.finishProviderSyncAttempt({ sessionId: session.id, workerId, status: 'pending', nextPollAt: next, errorCode: outcome.errorCode ?? null, errorCategory: outcome.errorCategory ?? null });
            result.retried += 1;
          } else {
            if (outcome.reportId) {
              await lifecycle?.finalizeReport({ session, reportId: outcome.reportId, finalizedAt: current.toISOString() });
              await store.finishProviderSyncAttempt({ sessionId: session.id, workerId, status: 'completed', reportId: outcome.reportId });
              result.completed += 1;
            } else {
              await store.finishProviderSyncAttempt({ sessionId: session.id, workerId, status: 'finalization_pending', errorCode: outcome.errorCode ?? 'report_finalization_pending', errorCategory: 'retryable' });
              result.finalizationPending += 1;
            }
          }
        } else {
          await store.finishProviderSyncAttempt({ sessionId: session.id, workerId, status: outcome.status, errorCode: outcome.errorCode, errorCategory: outcome.errorCategory });
          result.failed += 1;
        }
      } catch (error) {
        const category = error?.category ?? 'unknown';
        const next = category === 'retryable' ? nextPollAt(session, config.pollOffsetsMinutes, current) : null;
        const status = next ? 'pending' : category === 'configuration' ? 'configuration_failure' : category === 'permanent' ? 'permanent_failure' : 'finalization_pending';
        await store.finishProviderSyncAttempt({ sessionId: session.id, workerId, status, nextPollAt: next, errorCode: error?.code ?? 'webinarstars_unknown_error', errorCategory: category });
        if (next) result.retried += 1; else if (status === 'finalization_pending') result.finalizationPending += 1; else result.failed += 1;
        safeLog(logger, 'webinarstars_sync_error', { category, status });
      }
    }
    return result;
  }

  async function retrySession(sessionId) {
    return store.retryProviderSyncSession({ sessionId, provider, nextPollAt: now().toISOString() });
  }

  return Object.freeze({ run, retrySession });
}
