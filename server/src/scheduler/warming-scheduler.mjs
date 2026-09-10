import { randomUUID } from 'node:crypto';
import { getDeliverySuppressionReason } from '../delivery/recovery-executor.mjs';

const progressEvents = new Set(['watched_50', 'watched_75', 'watched_90', 'webinar_completed']);
const applicationProgressEvents = new Set(['cta_clicked', 'application_started', 'application_submitted']);
const webinarActivityEvents = new Set(['webinar_started', 'watched_25', ...progressEvents]);

export function cancellationReasonForRule(rule, events) {
  const types = new Set(events.map((event) => event.eventType));
  if (!rule || rule.status !== 'active') return 'warming_rule_inactive';
  if (rule.name.startsWith('webinar_reminder_') && (types.has('webinar_started') || [...progressEvents].some((type) => types.has(type)))) return 'webinar_started';
  if (rule.name === 'continue_watching_6h' && [...progressEvents].some((type) => types.has(type))) return 'webinar_progress_reached';
  if (rule.name === 'application_follow_up_2h' && [...applicationProgressEvents].some((type) => types.has(type))) {
    return types.has('application_submitted') ? 'application_submitted' : 'application_progressed';
  }
  return null;
}

function safeLog(logger, event, details) {
  if (typeof logger?.info === 'function') logger.info({ event, ...details });
}

export function createWarmingScheduler({ store, funnelId, policy, deliverOperation, now = () => new Date(), random = Math.random, workerId = `scheduler-${randomUUID()}`, leaseMs = 30_000, logger = null } = {}) {
  if (!store || !funnelId || !policy || typeof deliverOperation !== 'function') throw new Error('scheduler dependencies are required');

  async function scheduleForTrigger({ userId, triggerEvent, triggeredAt, dependsOnOperationId = null }) {
    const user = await store.getUser(userId);
    if (!user || user.funnelId !== funnelId || !user.funnelEntryTouch) return [];
    if (await getDeliverySuppressionReason(store, userId, funnelId)) return [];
    const rules = (await store.listAutomationRules(funnelId)).filter((rule) => rule.triggerEvent === triggerEvent && rule.actionType === 'send_message');
    const telegram = await store.getTelegramUser(userId);
    const existing = (await store.listDeliveryOperations({ userId })).filter((operation) => operation.messageType === 'warming');
    const created = [];
    for (const rule of rules) {
      if (existing.length + created.length >= policy.maxScheduledPerFunnelEntry) break;
      const template = await store.findMessageTemplate(funnelId, rule.actionConfig?.templateName);
      if (!template || template.messageClass !== rule.messageClass) continue;
      const scheduledFor = new Date(new Date(triggeredAt).getTime() + rule.delaySeconds * 1000);
      const jitterSeconds = Math.floor(random() * (policy.jitterMaxSeconds + 1));
      const earliestExecutionAt = new Date(scheduledFor.getTime() + jitterSeconds * 1000);
      const operationKey = `warming:${userId}:${rule.id}:${rule.version}`;
      const previous = await store.getDeliveryOperationByKey(funnelId, operationKey);
      const operation = await store.createScheduledDeliveryOperation({
        operationKey, funnelId, userId,
        telegramChatId: telegram?.telegramChatId ?? telegram?.telegramUserId,
        warmingRuleId: rule.id, messageClass: rule.messageClass, funnelEntryKey: userId,
        scheduledFor: scheduledFor.toISOString(), earliestExecutionAt: earliestExecutionAt.toISOString(),
        dependsOnOperationId,
        descriptor: {
          templateName: template.name, templateId: template.id, templateVersion: template.version,
          ruleName: rule.name, ruleVersion: rule.version, messageClass: rule.messageClass,
          triggeredAt: new Date(triggeredAt).toISOString(), jitterSeconds,
        },
      });
      if (!previous) created.push(operation);
    }
    return created;
  }

  async function reconcileAfterEvent({ userId, eventType }) {
    if (['telegram_stop', 'data_deletion_requested'].includes(eventType)) {
      return store.cancelScheduledWarming({ userId, funnelId, reason: eventType, status: 'suppressed' });
    }
    const operations = (await store.listDeliveryOperations({ userId })).filter((operation) => operation.messageType === 'warming' && operation.status === 'scheduled');
    const rules = await store.listAutomationRules(funnelId);
    const events = await store.listUserEvents(userId);
    const cancelled = [];
    for (const operation of operations) {
      const reason = cancellationReasonForRule(rules.find((item) => item.id === operation.warmingRuleId), events);
      if (!reason) continue;
      const result = await store.cancelScheduledOperation({ operationId: operation.id, reason });
      if (result) cancelled.push(result);
    }
    return cancelled;
  }

  async function promotionalLimitReached(operation, currentTime) {
    if (operation.messageClass !== 'promotional') return false;
    const windowStart = currentTime.getTime() - policy.promotionalRollingPeriodSeconds * 1000;
    const delivered = (await store.listDeliveryOperations({ userId: operation.userId })).filter((item) => item.messageType === 'warming'
      && item.messageClass === 'promotional' && item.status === 'delivered' && new Date(item.deliveredAt).getTime() >= windowStart);
    return delivered.length >= policy.maxPromotionalDelivered;
  }

  async function run({ limit = 100 } = {}) {
    const currentTime = now();
    const snapshot = await store.schedulerSnapshot({ funnelId, now: currentTime.toISOString() });
    const result = { workerId, considered: snapshot.considered, due: snapshot.due, claimed: 0, cancelled: 0, suppressed: 0, delivered: 0, errors: 0, deferred: 0, notDue: snapshot.notDue };
    while (result.claimed < limit) {
      const operation = await store.claimScheduledOperation({ funnelId, workerId, leaseMs, now: currentTime.toISOString() });
      if (!operation) break;
      result.claimed += 1;
      const suppressionReason = await getDeliverySuppressionReason(store, operation.userId, funnelId);
      if (suppressionReason) {
        await store.finishScheduledOperation({ operationId: operation.id, workerId, status: 'suppressed', cancellationReason: suppressionReason });
        await store.cancelScheduledWarming({ userId: operation.userId, funnelId, reason: suppressionReason, status: 'suppressed' });
        result.suppressed += 1;
        continue;
      }
      const user = await store.getUser(operation.userId);
      if (!user?.funnelEntryTouch) {
        await store.finishScheduledOperation({ operationId: operation.id, workerId, status: 'cancelled', cancellationReason: 'funnel_entry_missing' });
        result.cancelled += 1;
        continue;
      }
      const dependency = operation.dependsOnOperationId ? await store.getDeliveryOperation(operation.dependsOnOperationId) : null;
      if (dependency && dependency.status !== 'delivered') {
        if (['dead_letter', 'delivery_unknown', 'suppressed', 'cancelled'].includes(dependency.status)) {
          await store.finishScheduledOperation({ operationId: operation.id, workerId, status: 'cancelled', cancellationReason: `dependency_${dependency.status}` });
          result.cancelled += 1;
        } else {
          await store.finishScheduledOperation({ operationId: operation.id, workerId, status: 'scheduled' });
          result.deferred += 1;
          break;
        }
        continue;
      }
      const rules = await store.listAutomationRules(funnelId);
      const rule = rules.find((item) => item.id === operation.warmingRuleId);
      const events = await store.listUserEvents(operation.userId);
      const cancellationReason = cancellationReasonForRule(rule, events);
      if (cancellationReason || await promotionalLimitReached(operation, currentTime)) {
        await store.finishScheduledOperation({ operationId: operation.id, workerId, status: 'cancelled', cancellationReason: cancellationReason ?? 'promotional_message_limit' });
        result.cancelled += 1;
        continue;
      }
      if (rule.name === 'continue_watching_6h' && rule.conditions?.inactive) {
        const latestActivity = events.filter((event) => webinarActivityEvents.has(event.eventType)).at(-1);
        const triggerTime = new Date(operation.descriptor.triggeredAt).getTime();
        const activityTime = latestActivity ? new Date(latestActivity.occurredAt).getTime() : triggerTime;
        if (activityTime > triggerTime) {
          const deferredUntil = new Date(activityTime + rule.delaySeconds * 1000 + operation.descriptor.jitterSeconds * 1000);
          if (deferredUntil > currentTime) {
            await store.finishScheduledOperation({ operationId: operation.id, workerId, status: 'scheduled', earliestExecutionAt: deferredUntil.toISOString() });
            result.deferred += 1;
            continue;
          }
        }
      }
      await store.finishScheduledOperation({ operationId: operation.id, workerId, status: 'pending' });
      const delivery = await deliverOperation(operation.id);
      const saved = delivery?.results?.[0] ?? await store.getDeliveryOperation(operation.id);
      if (saved?.status === 'delivered') result.delivered += 1;
      else if (saved?.status === 'suppressed') result.suppressed += 1;
      else result.errors += 1;
    }
    safeLog(logger, 'warming_scheduler_complete', result);
    return result;
  }

  return Object.freeze({ scheduleForTrigger, reconcileAfterEvent, run, workerId });
}
