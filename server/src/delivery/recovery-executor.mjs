import { randomUUID } from 'node:crypto';

export const DELIVERY_STATES = Object.freeze([
  'pending', 'processing', 'delivered', 'retryable_failed',
  'delivery_unknown', 'dead_letter', 'suppressed',
]);

const unknownCodes = new Set([
  'telegram_timeout',
  'telegram_network_error',
  'telegram_malformed_response',
]);

export function classifyDeliveryError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'transport_failed';
  if (unknownCodes.has(code)) return { category: 'unknown', code };
  if (code === 'telegram_http_error' && (error.status === 429 || error.status >= 500)) {
    return { category: 'retryable', code };
  }
  return { category: 'permanent', code };
}

export function retryDelayMs(attemptNumber, baseDelayMs = 1000) {
  return Math.min(baseDelayMs * (2 ** Math.max(0, attemptNumber - 1)), 60 * 60 * 1000);
}

function safeLog(logger, event, operation, details = {}) {
  if (typeof logger?.info !== 'function') return;
  logger.info({
    event,
    operationId: operation.id,
    messageType: operation.messageType,
    attemptNumber: operation.attemptCount,
    ...details,
  });
}

export function createDeliveryRecoveryExecutor({
  store,
  transport,
  resolveMessage,
  buildOutcome,
  recordAttempt,
  workerId = `recovery-${randomUUID()}`,
  leaseMs = 30_000,
  baseDelayMs = 1_000,
  logger = null,
  now = () => new Date(),
} = {}) {
  if (!store || !transport || typeof resolveMessage !== 'function') throw new Error('recovery dependencies are required');

  async function processClaimed(operation) {
    const user = await store.getUser(operation.userId);
    const deletion = user ? await store.getDataDeletionRequest({ userId: user.id, funnelId: user.funnelId }) : null;
    const suppressionReason = !user
      ? 'user_missing'
      : user.leadStatus === 'sold'
        ? 'sold'
        : user.promotionalEnabled === false || user.stopRequestedAt
          ? 'telegram_stop'
          : user.deletionRequestedAt || deletion
            ? 'data_deletion_requested'
            : null;
    if (suppressionReason) {
      const outcome = await buildOutcome?.({ operation, status: 'suppressed', suppressionReason });
      const saved = await store.finishDeliveryOperation({ operationId: operation.id, workerId, status: 'suppressed', errorCode: suppressionReason, errorCategory: 'permanent', outcome });
      safeLog(logger, 'delivery_suppressed', saved, { resultCategory: suppressionReason });
      return saved;
    }

    const started = await store.markDeliveryAttemptStarted({ operationId: operation.id, workerId });
    if (!started) return null;
    safeLog(logger, 'delivery_attempt_started', started);
    try {
      await recordAttempt?.(started);
      const message = await resolveMessage(started);
      const result = await transport.sendMessage({
        userId: started.userId,
        funnelId: started.funnelId,
        telegramChatId: started.telegramChatId,
        message,
      });
      const outcome = await buildOutcome?.({ operation: started, status: 'delivered', result, message });
      const saved = await store.finishDeliveryOperation({
        operationId: started.id,
        workerId,
        status: 'delivered',
        provider: result.provider,
        providerMessageId: result.messageId,
        outcome,
      });
      safeLog(logger, 'delivery_delivered', saved, { resultCategory: 'delivered' });
      return saved;
    } catch (error) {
      const failure = classifyDeliveryError(error);
      const exhausted = started.attemptCount >= started.maxAttempts;
      const status = failure.category === 'unknown'
        ? 'delivery_unknown'
        : failure.category === 'retryable' && !exhausted
          ? 'retryable_failed'
          : 'dead_letter';
      const nextAttemptAt = status === 'retryable_failed'
        ? new Date(now().getTime() + retryDelayMs(started.attemptCount, baseDelayMs)).toISOString()
        : null;
      const outcome = await buildOutcome?.({ operation: started, status, errorCode: failure.code, errorCategory: failure.category });
      const saved = await store.finishDeliveryOperation({
        operationId: started.id,
        workerId,
        status,
        errorCode: failure.code,
        errorCategory: failure.category,
        nextAttemptAt,
        outcome,
      });
      safeLog(logger, status === 'retryable_failed' ? 'delivery_retry_scheduled' : `delivery_${status}`, saved, {
        resultCategory: failure.category,
        retryScheduled: status === 'retryable_failed',
      });
      return saved;
    }
  }

  async function run({ limit = 100, operationId = null } = {}) {
    const results = [];
    while (results.length < limit) {
      const claimed = await store.claimDeliveryOperation({
        workerId,
        leaseMs,
        operationId,
        now: now().toISOString(),
      });
      if (!claimed) break;
      results.push(await processClaimed(claimed));
      if (operationId) break;
    }
    return { workerId, claimed: results.length, results };
  }

  return Object.freeze({ run, processClaimed, workerId });
}
