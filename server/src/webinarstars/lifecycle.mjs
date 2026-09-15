import { randomUUID } from 'node:crypto';
import { classifyDeliveryError, getDeliverySuppressionReason } from '../delivery/recovery-executor.mjs';
import { decideWebinarStarsSegment, WEBINARSTARS_FOLLOW_UP_POLICY, WEBINARSTARS_FOLLOW_UP_TEMPLATE_CONTRACTS } from './lifecycle-policy.mjs';

export function createWebinarStarsLifecycle({ store, config, now = () => new Date() } = {}) {
  if (!store || !config) throw new Error('WebinarStars lifecycle dependencies are required');

  async function finalizeReport({ session, reportId, finalizedAt = now().toISOString() }) {
    const entries = await store.listProviderSessionEntries(session.id);
    const result = { decisions: 0, scheduled: 0, duplicates: 0 };
    for (const entry of entries) {
      const visitor = await store.findProviderVisitorForUser({ sessionId: session.id, userId: entry.userId });
      const application = await store.getApplicationForUser(entry.userId);
      const suppressionReason = await getDeliverySuppressionReason(store, entry.userId, entry.funnelId);
      const segment = decideWebinarStarsSegment({
        visitorSignals: visitor?.signals ?? null,
        applicationSubmitted: application?.status === 'submitted',
        suppressionReason,
        offerBoundarySeconds: config.offerBoundarySeconds,
      });
      const saved = await store.createProviderSegmentDecision({
        id: randomUUID(), provider: 'webinarstars', sessionId: session.id, reportId,
        funnelEntryId: entry.funnelEntryId, userId: entry.userId, funnelId: entry.funnelId,
        segment, decidedAt: finalizedAt,
        signals: { visitorMatched: Boolean(visitor), presenceSeconds: visitor?.signals?.presenceSeconds ?? null,
          presenceRatioCapped: visitor?.signals?.presenceRatio ?? null, targetCtaSeen: visitor?.signals?.targetCtaSeen ?? false,
          targetCtaClicked: visitor?.signals?.targetCtaClicked ?? false, suppressionReason },
      });
      if (saved.duplicate) result.duplicates += 1; else result.decisions += 1;
      const snapshotSegment = saved.record.segment;
      const rule = WEBINARSTARS_FOLLOW_UP_POLICY[snapshotSegment];
      const template = WEBINARSTARS_FOLLOW_UP_TEMPLATE_CONTRACTS[snapshotSegment];
      if (!rule || !template) continue;
      const scheduledFor = new Date(new Date(finalizedAt).getTime() + rule.delayMinutes * 60_000).toISOString();
      const followUp = await store.scheduleProviderFollowUp({
        id: randomUUID(), decisionId: saved.record.id, funnelEntryId: entry.funnelEntryId,
        reportId, funnelId: entry.funnelId, userId: entry.userId, segment: snapshotSegment,
        followUpRule: rule.ruleId, templateId: template.templateId, scheduledFor,
      });
      if (!followUp.duplicate) result.scheduled += 1;
    }
    return result;
  }

  return Object.freeze({ finalizeReport });
}

export function createWebinarStarsFollowUpScheduler({ store, config, experienceProvider, applicationUrlProvider = null, transport, templates = {},
  now = () => new Date(), workerId = `webinarstars-follow-up-${randomUUID()}`, leaseMs = 30_000 } = {}) {
  if (!store || !config || !experienceProvider || !transport) throw new Error('WebinarStars follow-up scheduler dependencies are required');

  async function run({ limit = 100 } = {}) {
    const result = { workerId, claimed: 0, delivered: 0, cancelled: 0, suppressed: 0, blockedTemplate: 0, deliveryUnknown: 0, failed: 0 };
    while (result.claimed < limit) {
      const operation = await store.claimProviderFollowUp({ workerId, leaseMs, now: now().toISOString() });
      if (!operation) break;
      result.claimed += 1;
      const application = await store.getApplicationForUser(operation.userId);
      if (application?.status === 'submitted') {
        await store.finishProviderFollowUp({ id: operation.id, workerId, status: 'cancelled', cancellationReason: 'application_submitted' });
        result.cancelled += 1;
        continue;
      }
      const suppressionReason = await getDeliverySuppressionReason(store, operation.userId, operation.funnelId);
      if (suppressionReason) {
        await store.finishProviderFollowUp({ id: operation.id, workerId, status: 'suppressed', cancellationReason: suppressionReason });
        result.suppressed += 1;
        continue;
      }
      const template = templates[operation.segment];
      const contract = WEBINARSTARS_FOLLOW_UP_TEMPLATE_CONTRACTS[operation.segment];
      const validContract = template?.templateId === operation.templateId
        && template?.templateId === contract?.templateId
        && template?.purpose === contract?.purpose
        && template?.cta === contract?.cta
        && template?.variables?.length === 1
        && template.variables[0] === contract?.variables?.[0];
      if (!template?.approved || !validContract || typeof template.text !== 'string' || !template.text.trim()) {
        await store.finishProviderFollowUp({ id: operation.id, workerId, status: 'blocked_template', cancellationReason: 'template_not_approved' });
        result.blockedTemplate += 1;
        continue;
      }
      try {
        const user = await store.getUser(operation.userId);
        const telegram = await store.getTelegramUser(operation.userId);
        if (!user || !telegram) throw new Error('delivery_identity_missing');
        const lateApplication = await store.getApplicationForUser(operation.userId);
        if (lateApplication?.status === 'submitted') {
          await store.finishProviderFollowUp({ id: operation.id, workerId, status: 'cancelled', cancellationReason: 'application_submitted' });
          result.cancelled += 1;
          continue;
        }
        const lateSuppression = await getDeliverySuppressionReason(store, operation.userId, operation.funnelId);
        if (lateSuppression) {
          await store.finishProviderFollowUp({ id: operation.id, workerId, status: 'suppressed', cancellationReason: lateSuppression });
          result.suppressed += 1;
          continue;
        }
        const variables = {};
        if (template.cta === 'next_webinar') variables.next_webinar_url = (await experienceProvider.createExperienceUrl({ user })).url;
        if (template.cta === 'application') {
          if (!applicationUrlProvider?.createApplicationUrl) throw new Error('application_url_provider_missing');
          variables.application_url = (await applicationUrlProvider.createApplicationUrl({ user })).url;
        }
        if (Object.keys(variables).some((key) => !template.variables.includes(key))) throw new Error('template_variable_not_allowed');
        const started = await store.markProviderFollowUpRequestStarted({ id: operation.id, workerId });
        if (!started) throw new Error('follow_up_lease_lost');
        const sent = await transport.sendMessage({ userId: user.id, funnelId: user.funnelId, telegramChatId: telegram.telegramChatId,
          message: { role: 'webinar_follow_up', text: template.text, buttons: [{ type: 'url', label: template.ctaLabel ?? 'Перейти', url: variables[template.variables[0]] }], templateId: template.templateId, variables } });
        await store.finishProviderFollowUp({ id: operation.id, workerId, status: 'delivered', provider: sent.provider, providerMessageId: sent.messageId });
        result.delivered += 1;
      } catch (error) {
        const failure = classifyDeliveryError(error);
        const status = failure.category === 'unknown' ? 'delivery_unknown' : 'failed';
        await store.finishProviderFollowUp({ id: operation.id, workerId, status, cancellationReason: failure.code });
        if (status === 'delivery_unknown') result.deliveryUnknown += 1; else result.failed += 1;
      }
    }
    return result;
  }
  return Object.freeze({ run });
}
