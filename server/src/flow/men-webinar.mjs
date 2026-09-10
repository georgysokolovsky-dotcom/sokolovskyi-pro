import {
  FUNNEL_ID,
  FUNNEL_EVENTS,
  WEBINAR_EVENTS,
  APPLICATION_FIELDS,
  PUBLIC_EVENT_METADATA_KEYS,
  BONUS_DELIVERY_MODES,
} from '../constants.mjs';
import { signFunnelToken, verifyFunnelToken } from '../security/signed-tokens.mjs';
import { buildTelegramDeepLink } from '../telegram/deep-links.mjs';
import { createDevTelegramTransport } from '../telegram/transport.mjs';
import { createDeliveryRecoveryExecutor } from '../delivery/recovery-executor.mjs';
import { cancellationReasonForRule, createWarmingScheduler } from '../scheduler/warming-scheduler.mjs';
import { WEBINAR_PLAYER_ACTIONS } from '../webinar/progress.mjs';

const sourcePattern = /^[a-z0-9_-]{1,64}$/i;
const maxTextLength = 2000;
const maxNameLength = 200;
const tokenTtlSeconds = 60 * 60;
const minimumMediaTokenTtlSeconds = 15 * 60;
const mediaPlaybackBufferSeconds = 10 * 60;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultEntryNotice = Object.freeze({
  version: 'men_webinar_v1-entry-notice-1',
  source: 'telegram-start',
});

class FunnelError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function requireText(value, field, { max = maxTextLength } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new FunnelError('invalid_input', `Invalid ${field}`);
  }
  return value.trim();
}

function safeEventMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return Object.fromEntries(PUBLIC_EVENT_METADATA_KEYS
    .filter((key) => (typeof metadata[key] === 'string' || typeof metadata[key] === 'number') && String(metadata[key]).length <= 120)
    .map((key) => [key, String(metadata[key])]));
}

function sanitizeAnswers(answers = {}) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new FunnelError('invalid_input', 'Invalid answers');
  }
  const sanitized = {};
  for (const field of APPLICATION_FIELDS) {
    if (answers[field] == null || answers[field] === '') continue;
    if (typeof answers[field] !== 'string') throw new FunnelError('invalid_input', `Invalid ${field}`);
    const value = answers[field].trim();
    const max = field === 'name' ? maxNameLength : maxTextLength;
    if (value.length > max) throw new FunnelError('invalid_input', `Invalid ${field}`);
    sanitized[field] = value;
  }
  if (!sanitized.name) throw new FunnelError('invalid_input', 'Name is required');
  if (!sanitized.situation) throw new FunnelError('invalid_input', 'Situation is required');
  return sanitized;
}

function assertConsent(consent) {
  if (!consent || consent.accepted !== true) throw new FunnelError('consent_required', 'Consent is required');
  return {
    accepted: true,
    policyVersion: requireText(consent.policyVersion, 'policyVersion', { max: 80 }),
    source: requireText(consent.source, 'consentSource', { max: 80 }),
    timestamp: typeof consent.timestamp === 'string' && consent.timestamp ? consent.timestamp : new Date().toISOString(),
  };
}

function transitionForEvent(eventType) {
  if (eventType === 'telegram_start') return 'telegram_lead';
  if (['bonus_sent', 'bonus_delivery_failed'].includes(eventType)) return 'warming';
  if (eventType === 'webinar_started') return 'webinar_started';
  if (['watched_25', 'watched_50', 'watched_75', 'watched_90', 'watched_100', 'webinar_completed'].includes(eventType)) return 'webinar_engaged';
  if (eventType === 'application_started') return 'application_started';
  if (eventType === 'application_submitted') return 'application_submitted';
  if (eventType === 'telegram_stop') return 'unsubscribed';
  return null;
}

function buildTouch(source, occurredAt) {
  return {
    sourceId: source.id,
    source: source.source,
    medium: source.medium,
    campaign: source.campaign,
    content: source.content,
    articleSlug: source.articleSlug ?? null,
    startParameter: source.startParameter,
    occurredAt,
  };
}

function sourceMetadata(source) {
  return {
    source_id: source.id,
    source: source.source,
    medium: source.medium,
    campaign: source.campaign,
    content: source.content,
    source_article_slug: source.articleSlug ?? '',
    start_parameter: source.startParameter,
  };
}

function buildTemplateMessage(template, { role = template?.role, bonus = null, webinarUrl = null, applicationUrl = null } = {}) {
  if (!template) return null;
  return {
    role,
    templateId: template.id,
    templateName: template.name,
    templateVersion: template.version,
    messageClass: template.messageClass ?? 'funnel_service',
    text: template.text,
    buttons: template.buttons.map((button) => {
      if (button.type === 'bonus_link' && bonus) {
        if (bonus.deliveryMode === 'telegram_audio') return { type: 'telegram_audio', label: button.label, fileId: bonus.telegramFileId };
        return { type: 'url', label: button.label, url: bonus.contentRef };
      }
      if (button.type === 'signed_video' && webinarUrl) return { type: 'url', label: button.label, url: webinarUrl };
      if (button.type === 'signed_application' && applicationUrl) return { type: 'url', label: button.label, url: applicationUrl };
      return button;
    }),
  };
}

export { FunnelError };

export function createMenWebinarFlow({
  store,
  signingSecret,
  botUsername,
  applicationReference = 'lab://men-funnel/application',
  webinarBaseUrl = null,
  entryNotice = defaultEntryNotice,
  transport = createDevTelegramTransport(),
  recoveryOptions = {},
  warmingPolicy = { jitterMaxSeconds: 60, maxScheduledPerFunnelEntry: 4, maxPromotionalDelivered: 2, promotionalRollingPeriodSeconds: 7 * 24 * 60 * 60 },
  schedulerOptions = {},
  now = () => new Date(),
  playerPolicy = { telemetryToleranceSeconds: 2, maxTelemetryGapSeconds: 15 },
}) {
  if (!store) throw new Error('store is required');
  if (!transport || typeof transport.sendMessage !== 'function') throw new Error('transport.sendMessage is required');

  async function resolveToken(token, purpose) {
    const result = verifyFunnelToken(token, { purpose, secret: signingSecret, now: () => now().getTime() });
    if (!result.ok) throw new FunnelError(result.code, 'Invalid or expired funnel token', 401);
    const user = await store.getUser(result.payload.user_ref);
    if (!user || user.funnelId !== result.payload.funnel_id) {
      throw new FunnelError('invalid_token', 'Invalid funnel token', 401);
    }
    return { user, payload: result.payload };
  }

  function issueToken({ user, purpose, videoId = null, ttlSeconds = tokenTtlSeconds }) {
    const token = signFunnelToken({
      purpose,
      userRef: user.id,
      funnelId: user.funnelId,
      videoId,
      ttlSeconds,
      secret: signingSecret,
      now: () => now().getTime(),
    });
    const issuedAt = Math.floor(now().getTime() / 1000);
    return {
      token,
      purpose,
      expiresInSeconds: ttlSeconds,
      expiresAt: new Date((issuedAt + ttlSeconds) * 1000).toISOString(),
    };
  }

  async function issueWebinarToken(user) {
    const webinar = await store.findWebinarForFunnel(user.funnelId);
    const token = issueToken({ user, purpose: 'webinar' });
    const configuredBase = typeof webinarBaseUrl === 'string' && webinarBaseUrl.trim()
      ? webinarBaseUrl.trim().replace(/\/+$/, '')
      : null;
    const videoReference = configuredBase
      ? `${configuredBase}/${encodeURIComponent(webinar?.videoId ?? 'unconfigured')}`
      : `lab://men-funnel/video/${encodeURIComponent(webinar?.videoId ?? 'unconfigured')}`;
    const separator = videoReference.includes('?') ? '&' : '?';
    return {
      ...token,
      url: `${videoReference}${separator}t=${encodeURIComponent(token.token)}`,
    };
  }

  function issueApplicationToken(user) {
    const token = issueToken({ user, purpose: 'application' });
    const separator = applicationReference.includes('?') ? '&' : '?';
    return {
      ...token,
      url: `${applicationReference}${separator}t=${encodeURIComponent(token.token)}`,
    };
  }

  function issueMediaToken(user, webinar) {
    const ttlSeconds = Math.max(
      minimumMediaTokenTtlSeconds,
      Math.ceil(Number(webinar.durationSeconds)) + mediaPlaybackBufferSeconds,
    );
    return issueToken({ user, purpose: 'media', videoId: webinar.videoId, ttlSeconds });
  }

  async function recordUserEvent({ userId, funnelId, eventType, metadata = {}, idempotencyKey = null }) {
    if (!FUNNEL_EVENTS.includes(eventType)) throw new FunnelError('invalid_event', 'Unsupported event type');
    const current = await store.getUser(userId);
    if (!current || current.funnelId !== funnelId) throw new FunnelError('not_found', 'User not found', 404);
    const result = await store.addEvent({
      userId,
      funnelId,
      eventType,
      metadata: safeEventMetadata(metadata),
      idempotencyKey,
    });
    if (!result.duplicate) {
      const transition = transitionForEvent(eventType);
      if (transition) await store.updateUser(userId, { leadStatus: transition });
      if (eventType === 'telegram_stop') {
        await store.setPromotionalEnabled(userId, false, result.event.occurredAt);
      }
      if (eventType === 'data_deletion_requested') {
        await store.requestDataDeletion({ userId, funnelId });
      }
      await warmingScheduler.reconcileAfterEvent({ userId, eventType });
      await scheduleWarmingForEvent({ userId, eventType, occurredAt: result.event.occurredAt });
    }
    return { ...result, status: (await store.getUser(userId)).leadStatus };
  }

  async function bonusDeliveryStatus(userId, bonusId) {
    const events = (await store.listUserEvents(userId)).filter((event) => event.metadata?.bonus_id === bonusId);
    const sent = events.find((event) => event.eventType === 'bonus_sent');
    if (sent) return { status: 'sent', event: sent };
    const failed = [...events].reverse().find((event) => event.eventType === 'bonus_delivery_failed');
    if (failed) return { status: 'failed', event: failed };
    const attempted = [...events].reverse().find((event) => event.eventType === 'bonus_delivery_attempted');
    if (attempted) return { status: 'attempted', event: attempted };
    return { status: 'not_started', event: null };
  }

  async function webinarInviteDeliveryStatus(userId) {
    const events = await store.listUserEvents(userId);
    const sent = events.find((event) => event.eventType === 'webinar_invite_sent');
    if (sent) return { status: 'sent', event: sent };
    const failed = [...events].reverse().find((event) => event.eventType === 'webinar_invite_delivery_failed');
    if (failed) return { status: 'failed', event: failed };
    const attempted = [...events].reverse().find((event) => event.eventType === 'webinar_invite_delivery_attempted');
    if (attempted) return { status: 'attempted', event: attempted };
    return { status: 'not_started', event: null };
  }

  async function resolveDeliveryMessage(operation) {
    const descriptor = operation.descriptor ?? {};
    const template = await store.findMessageTemplate(operation.funnelId, descriptor.templateName);
    if (!template) throw new FunnelError('invalid_message_config', 'Telegram message config is unavailable', 500);
    if (operation.messageType === 'bonus') {
      const bonus = await store.findBonusForFunnel(operation.funnelId, 'entry');
      if (!bonus || bonus.id !== descriptor.bonusId || bonus.version !== descriptor.bonusVersion) {
        throw new FunnelError('invalid_bonus_config', 'Telegram bonus config is unavailable', 500);
      }
      return buildTemplateMessage(template, { role: 'bonus', bonus });
    }
    if (operation.messageType === 'webinar_invite') {
      const user = await store.getUser(operation.userId);
      const webinar = await issueWebinarToken(user);
      return buildTemplateMessage(template, { role: 'webinar_invite', webinarUrl: webinar.url });
    }
    if (operation.messageType === 'warming') {
      const user = await store.getUser(operation.userId);
      if (operation.descriptor.ruleName === 'application_follow_up_2h') {
        const application = issueApplicationToken(user);
        return buildTemplateMessage(template, { role: 'warming', applicationUrl: application.url });
      }
      const webinar = await issueWebinarToken(user);
      return buildTemplateMessage(template, { role: 'warming', webinarUrl: webinar.url });
    }
    return buildTemplateMessage(template);
  }

  async function recordDeliveryAttempt(operation) {
    if (operation.messageType === 'bonus') {
      await store.addEvent({
        userId: operation.userId, funnelId: operation.funnelId, eventType: 'bonus_delivery_attempted',
        metadata: { bonus_id: operation.descriptor.bonusId, bonus_version: operation.descriptor.bonusVersion, attempt_number: operation.attemptCount },
        idempotencyKey: `bonus-attempt:${operation.id}:${operation.attemptCount}`,
      });
    }
    if (operation.messageType === 'webinar_invite') {
      await store.addEvent({
        userId: operation.userId, funnelId: operation.funnelId, eventType: 'webinar_invite_delivery_attempted',
        metadata: { attempt_number: operation.attemptCount, purpose: 'webinar', template_id: operation.descriptor.templateId, template_version: operation.descriptor.templateVersion },
        idempotencyKey: `webinar-invite-attempt:${operation.id}:${operation.attemptCount}`,
      });
    }
    if (operation.messageType === 'warming') {
      await store.addEvent({
        userId: operation.userId, funnelId: operation.funnelId, eventType: 'warming_delivery_attempted',
        metadata: { attempt_number: operation.attemptCount, warming_rule_id: operation.warmingRuleId, warming_rule_name: operation.descriptor.ruleName, message_class: operation.messageClass, template_id: operation.descriptor.templateId, template_version: operation.descriptor.templateVersion },
        idempotencyKey: `warming-attempt:${operation.id}:${operation.attemptCount}`,
      });
    }
  }

  async function buildDeliveryOutcome({ operation, status, result, errorCategory, suppressionReason }) {
    if (status === 'suppressed') return { suppressionReason };
    const delivered = status === 'delivered';
    if (operation.messageType === 'entry_notice') {
      if (!delivered) return null;
      return {
        userPatch: {
          entryNotice: { ...entryNotice, funnelId: operation.funnelId, timestamp: operation.descriptor.occurredAt },
          leadStatus: 'telegram_lead',
        },
        event: {
          userId: operation.userId, funnelId: operation.funnelId, eventType: 'funnel_entry_notice_presented',
          metadata: { ...operation.descriptor.sourceMetadata, consent_or_request_version: entryNotice.version, source: entryNotice.source, provider: result.provider, provider_message_id: result.messageId, template_id: operation.descriptor.templateId, template_version: operation.descriptor.templateVersion },
          idempotencyKey: `entry-notice:${operation.userId}:${operation.funnelId}`,
        },
      };
    }
    if (operation.messageType === 'bonus') {
      return {
        event: {
          userId: operation.userId, funnelId: operation.funnelId,
          eventType: delivered ? 'bonus_sent' : 'bonus_delivery_failed',
          metadata: delivered
            ? { bonus_id: operation.descriptor.bonusId, bonus_version: operation.descriptor.bonusVersion, provider: result.provider, provider_message_id: result.messageId }
            : { bonus_id: operation.descriptor.bonusId, bonus_version: operation.descriptor.bonusVersion, attempt_number: operation.attemptCount, provider: transport.provider ?? 'unknown', result_category: errorCategory },
          idempotencyKey: delivered ? `bonus-sent:${operation.id}` : `bonus-failed:${operation.id}:${operation.attemptCount}`,
        },
      };
    }
    if (operation.messageType === 'webinar_invite') return {
      event: {
        userId: operation.userId, funnelId: operation.funnelId,
        eventType: delivered ? 'webinar_invite_sent' : 'webinar_invite_delivery_failed',
        metadata: delivered
          ? { purpose: 'webinar', provider: result.provider, provider_message_id: result.messageId, template_id: operation.descriptor.templateId, template_version: operation.descriptor.templateVersion }
          : { attempt_number: operation.attemptCount, purpose: 'webinar', provider: transport.provider ?? 'unknown', template_id: operation.descriptor.templateId, template_version: operation.descriptor.templateVersion, result_category: errorCategory },
        idempotencyKey: delivered ? `webinar-invite-sent:${operation.id}` : `webinar-invite-failed:${operation.id}:${operation.attemptCount}`,
      },
    };
    return {
      event: {
        userId: operation.userId, funnelId: operation.funnelId,
        eventType: delivered ? 'warming_sent' : 'warming_delivery_failed',
        metadata: delivered
          ? { provider: result.provider, provider_message_id: result.messageId, warming_rule_id: operation.warmingRuleId, warming_rule_name: operation.descriptor.ruleName, message_class: operation.messageClass, template_id: operation.descriptor.templateId, template_version: operation.descriptor.templateVersion }
          : { attempt_number: operation.attemptCount, provider: transport.provider ?? 'unknown', warming_rule_id: operation.warmingRuleId, warming_rule_name: operation.descriptor.ruleName, message_class: operation.messageClass, result_category: errorCategory },
        idempotencyKey: delivered ? `warming-sent:${operation.id}` : `warming-failed:${operation.id}:${operation.attemptCount}`,
      },
    };
  }

  async function validateDeliveryOperation(operation) {
    if (operation.messageType !== 'warming') return null;
    const user = await store.getUser(operation.userId);
    if (!user?.funnelEntryTouch) return { cancellationReason: 'funnel_entry_missing' };
    const rule = (await store.listAutomationRules(operation.funnelId)).find((item) => item.id === operation.warmingRuleId);
    const events = await store.listUserEvents(operation.userId);
    const cancellationReason = cancellationReasonForRule(rule, events);
    if (cancellationReason) return { cancellationReason };
    if (operation.messageClass === 'promotional') {
      const currentTime = (recoveryOptions.now ?? (() => new Date()))();
      const windowStart = currentTime.getTime() - warmingPolicy.promotionalRollingPeriodSeconds * 1000;
      const delivered = (await store.listDeliveryOperations({ userId: operation.userId })).filter((item) => item.messageType === 'warming'
        && item.messageClass === 'promotional' && item.status === 'delivered' && new Date(item.deliveredAt).getTime() >= windowStart);
      if (delivered.length >= warmingPolicy.maxPromotionalDelivered) return { cancellationReason: 'promotional_message_limit' };
    }
    return null;
  }

  const recoveryExecutor = createDeliveryRecoveryExecutor({
    store, transport, resolveMessage: resolveDeliveryMessage,
    recordAttempt: recordDeliveryAttempt, buildOutcome: buildDeliveryOutcome, validateOperation: validateDeliveryOperation,
    ...recoveryOptions,
  });

  const warmingScheduler = createWarmingScheduler({
    store, funnelId: FUNNEL_ID, policy: warmingPolicy,
    deliverOperation: (operationId) => recoveryExecutor.run({ operationId, limit: 1 }),
    ...schedulerOptions,
  });

  async function scheduleWarmingForEvent({ userId, eventType, occurredAt, dependsOnOperationId = null }) {
    if (!['bonus_sent', 'webinar_started', 'watched_75'].includes(eventType)) return [];
    let dependencyId = dependsOnOperationId;
    if (!dependencyId) {
      const operations = await store.listDeliveryOperations({ userId });
      dependencyId = operations.find((item) => item.messageType === 'webinar_invite' && item.status === 'delivered')?.id ?? null;
    }
    return warmingScheduler.scheduleForTrigger({ userId, triggerEvent: eventType, triggeredAt: occurredAt, dependsOnOperationId: dependencyId });
  }

  async function prepareDelivery({ user, updateId, messageType, descriptor, operationKey, dependsOnOperationId = null }) {
    const telegram = await store.getTelegramUser(user.id);
    return store.createDeliveryOperation({
      operationKey, funnelId: user.funnelId, userId: user.id, telegramUpdateId: updateId,
      telegramChatId: telegram?.telegramChatId ?? telegram?.telegramUserId,
      messageType, descriptor, dependsOnOperationId,
    });
  }

  async function executeDelivery({ operation }) {
    if (operation.status === 'delivered') {
      return { status: 'sent', duplicate: true, provider: operation.provider, providerMessageId: operation.providerMessageId, operation };
    }
    const run = await recoveryExecutor.run({ operationId: operation.id, limit: 1 });
    const saved = run.results[0] ?? await store.getDeliveryOperation(operation.id);
    return {
      status: saved.status === 'delivered' ? 'sent' : saved.status === 'suppressed' ? 'suppressed' : 'failed',
      provider: saved.provider, providerMessageId: saved.providerMessageId,
      errorCode: saved.lastErrorCode, operation: saved,
    };
  }

  async function deliverEntryNotice({ user, operation }) {
    const previous = (await store.listUserEvents(user.id)).find((event) => event.eventType === 'funnel_entry_notice_presented');
    if (previous) return { status: 'sent', event: previous, duplicate: true };
    return executeDelivery({ operation });
  }

  async function deliverBonus({ user, bonus, operation }) {
    if (!bonus) return { status: 'not_configured', event: null };
    const previous = await bonusDeliveryStatus(user.id, bonus.id);
    if (previous.status === 'sent') return { status: 'sent', event: previous.event, duplicate: true };

    return executeDelivery({ operation });
  }

  async function deliverWebinarInvite({ user, operation }) {
    const previous = await webinarInviteDeliveryStatus(user.id);
    if (previous.status === 'sent') return { status: 'sent', event: previous.event, duplicate: true };

    return executeDelivery({ operation });
  }

  async function handleTelegramStart({ telegramUserId, firstName = null, username = null, languageCode = null, startParameter, updateId = null, timestamp = null }) {
    if (telegramUserId == null) throw new FunnelError('invalid_input', 'telegramUserId is required');
    if (!sourcePattern.test(startParameter ?? '')) throw new FunnelError('invalid_start_parameter', 'Invalid start parameter');
    let source = await store.findSourceByStartParameter(FUNNEL_ID, startParameter);
    if (!source) throw new FunnelError('unknown_source', 'Unknown start parameter', 404);

    const occurredAt = timestamp ?? new Date().toISOString();
    const eventKey = updateId == null ? `telegram-start:${telegramUserId}:${startParameter}` : `telegram-update:${updateId}`;
    const firstTouch = buildTouch(source, occurredAt);
    const claimed = await store.claimTelegramStart({
      source, telegramUserId, telegramChatId: telegramUserId, firstName, username, languageCode,
      firstTouch, funnelEntryTouch: firstTouch, eventMetadata: sourceMetadata(source), eventKey, updateId, occurredAt,
    });
    const user = claimed.user;
    const startEvent = { event: claimed.event, duplicate: claimed.duplicate };
    if (startEvent.duplicate && startEvent.event?.metadata?.source_id) {
      source = await store.findSourceById(startEvent.event.metadata.source_id) ?? source;
    }

    const activeUser = await store.getUser(user.id);
    const bonus = await store.findBonusForFunnel(activeUser.funnelId, 'entry');
    if (bonus && !BONUS_DELIVERY_MODES.includes(bonus.deliveryMode)) {
      throw new FunnelError('invalid_bonus_config', 'Invalid bonus delivery mode', 500);
    }
    const noticeMessage = buildTemplateMessage(await store.findMessageTemplate(activeUser.funnelId, 'entry_notice'));
    const bonusMessage = buildTemplateMessage(
      await store.findMessageTemplate(activeUser.funnelId, 'podcast_bonus_intro'),
      { role: 'bonus', bonus },
    );
    const webinarTemplate = await store.findMessageTemplate(activeUser.funnelId, 'webinar_invite');
    if (!noticeMessage || !bonus || !bonusMessage || !webinarTemplate) {
      throw new FunnelError('invalid_message_config', 'Telegram message plan is incomplete', 500);
    }

    const messagePlan = [noticeMessage, bonusMessage];
    const previousNotice = (await store.listUserEvents(activeUser.id)).find((event) => event.eventType === 'funnel_entry_notice_presented');
    let noticeDelivery = previousNotice
      ? { status: 'sent', event: previousNotice, duplicate: true }
      : { status: 'not_started', event: null };
    let bonusDelivery = await bonusDeliveryStatus(activeUser.id, bonus.id);
    let webinarInviteDelivery = await webinarInviteDeliveryStatus(activeUser.id);
    let webinar = null;
    let prepared = null;

    if (!startEvent.duplicate) {
      const entryOperation = await prepareDelivery({
        user: activeUser, updateId, messageType: 'entry_notice',
        operationKey: `entry-notice:${activeUser.id}:${source.funnelId}`,
        descriptor: { templateName: 'entry_notice', templateId: noticeMessage.templateId, templateVersion: noticeMessage.templateVersion, occurredAt, sourceMetadata: sourceMetadata(source) },
      });
      const bonusOperation = await prepareDelivery({
        user: activeUser, updateId, messageType: 'bonus', dependsOnOperationId: entryOperation.id,
        operationKey: `bonus:${activeUser.id}:${bonus.id}:${bonus.version}`,
        descriptor: { templateName: 'podcast_bonus_intro', templateId: bonusMessage.templateId, templateVersion: bonusMessage.templateVersion, bonusId: bonus.id, bonusVersion: bonus.version },
      });
      const inviteOperation = await prepareDelivery({
        user: activeUser, updateId, messageType: 'webinar_invite', dependsOnOperationId: bonusOperation.id,
        operationKey: `webinar-invite:${activeUser.id}:${webinarTemplate.id}:${webinarTemplate.version}`,
        descriptor: { templateName: 'webinar_invite', templateId: webinarTemplate.id, templateVersion: webinarTemplate.version },
      });
      prepared = { entryOperation, bonusOperation, inviteOperation };

      noticeDelivery = await deliverEntryNotice({ user: activeUser, operation: entryOperation });
      if (noticeDelivery.status === 'sent') {
        bonusDelivery = await deliverBonus({ user: activeUser, bonus, operation: bonusOperation });
      }
    }

    if (bonusDelivery.status === 'sent') {
      webinar = await issueWebinarToken(activeUser);
      const webinarMessage = buildTemplateMessage(webinarTemplate, { role: 'webinar_invite', webinarUrl: webinar.url });
      messagePlan.push(webinarMessage);
      if (!startEvent.duplicate) {
        webinarInviteDelivery = await deliverWebinarInvite({ user: activeUser, operation: prepared.inviteOperation });
        if (webinarInviteDelivery.status === 'sent') {
          const deliveredBonus = await store.getDeliveryOperation(prepared.bonusOperation.id);
          await scheduleWarmingForEvent({ userId: activeUser.id, eventType: 'bonus_sent', occurredAt: deliveredBonus.deliveredAt, dependsOnOperationId: prepared.inviteOperation.id });
        }
      }
    }

    if (!startEvent.duplicate) {
      const failed = [
        ['entry_notice', noticeDelivery],
        ['bonus', bonusDelivery],
        ['webinar_invite', webinarInviteDelivery],
      ].find(([, delivery]) => ['failed', 'suppressed'].includes(delivery.status));
      await store.finishTelegramUpdate({
        funnelId: activeUser.funnelId,
        updateId,
        status: failed ? 'failed' : 'completed',
        errorStage: failed?.[0] ?? null,
        errorCode: failed?.[1]?.errorCode ?? (failed?.[1]?.status === 'suppressed' ? 'delivery_suppressed' : null),
      });
    }

    return {
      userId: activeUser.id,
      funnelId: activeUser.funnelId,
      source: {
        id: source.id,
        source: source.source,
        medium: source.medium,
        campaign: source.campaign,
        content: source.content,
        articleSlug: source.articleSlug ?? null,
        startParameter: source.startParameter,
      },
      attribution: {
        first_touch: activeUser.firstTouch,
        funnel_entry_touch: activeUser.funnelEntryTouch,
      },
      notice: {
        version: entryNotice.version,
        source: entryNotice.source,
        presented: noticeDelivery.status === 'sent',
        status: noticeDelivery.status,
      },
      telegramUrl: buildTelegramDeepLink({ botUsername, startParameter: source.startParameter }),
      bonus: bonus ? { id: bonus.id, type: bonus.type, deliveryMode: bonus.deliveryMode, title: bonus.title, contentRef: bonus.contentRef, telegramFileId: bonus.telegramFileId ?? null } : null,
      bonusDelivery: {
        status: bonusDelivery.status,
        provider: bonusDelivery.provider ?? null,
        providerMessageId: bonusDelivery.providerMessageId ?? null,
      },
      webinarInviteDelivery: {
        status: webinarInviteDelivery.status,
        provider: webinarInviteDelivery.provider ?? null,
        providerMessageId: webinarInviteDelivery.providerMessageId ?? null,
      },
      messagePlan,
      webinar,
      duplicate: startEvent.duplicate,
    };
  }

  async function createWebinarSession(token) {
    const { user, payload } = await resolveToken(token, 'webinar');
    const webinar = await store.findWebinarForFunnel(user.funnelId);
    if (!webinar || webinar.status !== 'active') throw new FunnelError('webinar_unavailable', 'Webinar is unavailable', 409);
    return {
      userId: user.id,
      funnelId: payload.funnel_id,
      purpose: payload.purpose,
      webinar: webinar ? { id: webinar.id, route: webinar.route, videoProvider: webinar.videoProvider, videoId: webinar.videoId, durationSeconds: webinar.durationSeconds } : null,
    };
  }

  function requireRequestId(value, field) {
    if (typeof value !== 'string' || !uuidPattern.test(value)) throw new FunnelError('invalid_input', `Invalid ${field}`);
    return value;
  }

  async function openWebinarPage({ token, videoId }) {
    const session = await createWebinarSession(token);
    if (!session.webinar || session.webinar.videoId !== videoId) throw new FunnelError('not_found', 'Webinar not found', 404);
    await recordUserEvent({
      userId: session.userId, funnelId: session.funnelId, eventType: 'webinar_page_view',
      metadata: { video_id: session.webinar.videoId },
      idempotencyKey: `webinar:${session.userId}:${session.webinar.id}:page-view`,
    });
    const user = await store.getUser(session.userId);
    const media = issueMediaToken(user, session.webinar);
    return {
      ...session,
      webinar: {
        ...session.webinar,
        videoUrl: `/v1/webinar/media/${encodeURIComponent(session.webinar.videoId)}?mt=${encodeURIComponent(media.token)}`,
      },
    };
  }

  async function authorizeWebinarMedia({ token, videoId }) {
    const { user, payload } = await resolveToken(token, 'media');
    if (payload.video_id !== videoId) throw new FunnelError('invalid_token', 'Invalid media token', 401);
    const webinar = await store.findWebinarForFunnel(user.funnelId);
    if (!webinar || webinar.status !== 'active' || webinar.videoId !== videoId) {
      throw new FunnelError('media_unavailable', 'Media is unavailable', 404);
    }
    return {
      userId: user.id,
      funnelId: user.funnelId,
      webinar: { id: webinar.id, videoId: webinar.videoId, videoProvider: webinar.videoProvider },
    };
  }

  async function ingestWebinarTelemetry({ token, clientSessionId, requestId, action, positionSeconds, durationSeconds }) {
    requireRequestId(clientSessionId, 'clientSessionId');
    requireRequestId(requestId, 'requestId');
    if (!WEBINAR_PLAYER_ACTIONS.includes(action)) throw new FunnelError('invalid_event', 'Unsupported player action');
    const position = Number(positionSeconds);
    const duration = Number(durationSeconds);
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0 || position < 0 || position > duration) {
      throw new FunnelError('invalid_input', 'Invalid player position');
    }
    const { user } = await resolveToken(token, 'webinar');
    const webinar = await store.findWebinarForFunnel(user.funnelId);
    if (!webinar || !Number.isFinite(webinar.durationSeconds)) throw new FunnelError('webinar_unavailable', 'Webinar is unavailable', 409);
    const durationTolerance = Math.max(1, webinar.durationSeconds * 0.02);
    if (Math.abs(duration - webinar.durationSeconds) > durationTolerance) throw new FunnelError('invalid_input', 'Invalid video duration');
    const telemetry = await store.ingestWebinarTelemetry({
      userId: user.id, funnelId: user.funnelId, webinarId: webinar.id,
      clientSessionId, requestId, action, positionSeconds: position,
      durationSeconds: webinar.durationSeconds, observedAt: now().toISOString(),
      toleranceSeconds: playerPolicy.telemetryToleranceSeconds,
      maxGapSeconds: playerPolicy.maxTelemetryGapSeconds,
    });
    if (telemetry.conflict) throw new FunnelError('idempotency_conflict', 'Telemetry request conflicts with an existing request', 409);
    const recorded = [];
    if (telemetry.started) {
      recorded.push(await recordUserEvent({
        userId: user.id, funnelId: user.funnelId, eventType: 'webinar_started',
        metadata: { video_id: webinar.videoId },
        idempotencyKey: `webinar:${user.id}:${webinar.id}:started`,
      }));
    }
    for (const threshold of telemetry.milestones) {
      const metadata = { video_id: webinar.videoId, threshold, watched_seconds: telemetry.watchedSeconds, progress_percent: telemetry.progressPercent };
      recorded.push(await recordUserEvent({
        userId: user.id, funnelId: user.funnelId, eventType: `watched_${threshold}`,
        metadata, idempotencyKey: `webinar:${user.id}:${webinar.id}:watched-${threshold}`,
      }));
      if (threshold === 100) recorded.push(await recordUserEvent({
        userId: user.id, funnelId: user.funnelId, eventType: 'webinar_completed',
        metadata, idempotencyKey: `webinar:${user.id}:${webinar.id}:completed`,
      }));
    }
    return {
      duplicate: telemetry.duplicate,
      watchedSeconds: telemetry.watchedSeconds,
      progressPercent: telemetry.progressPercent,
      milestones: telemetry.milestones,
      eventsCreated: recorded.filter((item) => !item.duplicate).map((item) => item.event.eventType),
    };
  }

  async function recordWebinarCta({ token, requestId }) {
    requireRequestId(requestId, 'requestId');
    const { user } = await resolveToken(token, 'webinar');
    const webinar = await store.findWebinarForFunnel(user.funnelId);
    return recordUserEvent({
      userId: user.id, funnelId: user.funnelId, eventType: 'cta_clicked',
      metadata: { video_id: webinar?.videoId ?? '', placement: 'webinar' },
      idempotencyKey: `webinar:${user.id}:${webinar?.id ?? 'unknown'}:cta-clicked`,
    });
  }

  async function recordApplicationStarted({ token, requestId }) {
    requireRequestId(requestId, 'requestId');
    const { user } = await resolveToken(token, 'application');
    return recordUserEvent({
      userId: user.id, funnelId: user.funnelId, eventType: 'application_started',
      metadata: { purpose: 'application' }, idempotencyKey: `application:${user.id}:started`,
    });
  }

  async function recordTokenEvent({ token, eventType, metadata, idempotencyKey }) {
    const purpose = WEBINAR_EVENTS.includes(eventType)
      ? 'webinar'
      : ['application_started', 'application_submitted'].includes(eventType)
        ? 'application'
        : null;
    if (!purpose) throw new FunnelError('invalid_event', 'Unsupported token event');
    const { user } = await resolveToken(token, purpose);
    return recordUserEvent({ userId: user.id, funnelId: user.funnelId, eventType, metadata, idempotencyKey });
  }

  async function createApplicationToken({ token }) {
    const { user } = await resolveToken(token, 'webinar');
    const hasCta = (await store.listUserEvents(user.id)).some((event) => event.eventType === 'cta_clicked');
    if (!hasCta) throw new FunnelError('cta_required', 'Webinar CTA is required', 409);
    return issueApplicationToken(user);
  }

  async function submitApplication({ token, answers, consent, idempotencyKey }) {
    const { user } = await resolveToken(token, 'application');
    const cleanAnswers = sanitizeAnswers(answers);
    const cleanConsent = assertConsent(consent);
    if (idempotencyKey != null && (typeof idempotencyKey !== 'string' || idempotencyKey.length > 120)) throw new FunnelError('invalid_input', 'Invalid idempotency key');
    const serverIdempotencyKey = `application:${user.id}:${user.funnelId}`;
    const result = await store.createApplicationWithEvent({ userId: user.id, funnelId: user.funnelId, answers: cleanAnswers, consent: cleanConsent, idempotencyKey: serverIdempotencyKey });
    if (!result.duplicate) await warmingScheduler.reconcileAfterEvent({ userId: user.id, eventType: 'application_submitted' });
    return { ...result, userId: user.id };
  }

  async function stopTelegramFlow({ telegramUserId, idempotencyKey = null }) {
    const user = await store.findUserByTelegramId(telegramUserId);
    if (!user) throw new FunnelError('not_found', 'Telegram user not found', 404);
    return recordUserEvent({
      userId: user.id,
      funnelId: user.funnelId,
      eventType: 'telegram_stop',
      metadata: {},
      idempotencyKey: idempotencyKey ?? `telegram-stop:${user.id}`,
    });
  }

  async function requestDataDeletion({ telegramUserId, idempotencyKey = null }) {
    const user = await store.findUserByTelegramId(telegramUserId);
    if (!user) throw new FunnelError('not_found', 'Telegram user not found', 404);
    const result = await recordUserEvent({
      userId: user.id,
      funnelId: user.funnelId,
      eventType: 'data_deletion_requested',
      metadata: {},
      idempotencyKey: idempotencyKey ?? `data-deletion:${user.id}`,
    });
    return { ...result, request: await store.getDataDeletionRequest({ userId: user.id, funnelId: user.funnelId }) };
  }

  async function leadDetails(userId) {
    const user = await store.getUser(userId);
    if (!user) throw new FunnelError('not_found', 'Lead not found', 404);
    const events = await store.listUserEvents(user.id);
    const webinarEvents = events.filter((event) => WEBINAR_EVENTS.includes(event.eventType));
    const progressEvent = [...['watched_100', 'watched_90', 'watched_75', 'watched_50', 'watched_25']]
      .map((eventType) => webinarEvents.find((event) => event.eventType === eventType))
      .find(Boolean);
    const bonusEvents = events.filter((event) => ['bonus_delivery_attempted', 'bonus_sent', 'bonus_delivery_failed'].includes(event.eventType));
    const latestBonusEvent = bonusEvents.at(-1) ?? null;
    const application = await store.getApplicationForUser(user.id);
    const source = user.sourceId ? await store.findSourceById(user.sourceId) : null;
    const webinar = await store.findWebinarForFunnel(user.funnelId);
    const firstTouch = user.firstTouch ?? (source ? buildTouch(source, user.createdAt) : null);
    return {
      id: user.id,
      funnelId: user.funnelId,
      leadStatus: user.leadStatus,
      source,
      attribution: {
        first_touch: firstTouch,
        funnel_entry_touch: user.funnelEntryTouch,
        article_slug: user.funnelEntryTouch?.articleSlug ?? null,
        funnel_id: user.funnelId,
      },
      entryNotice: user.entryNotice,
      telegram: await store.getTelegramUser(user.id),
      bonus: {
        status: latestBonusEvent?.eventType === 'bonus_sent'
          ? 'sent'
          : latestBonusEvent?.eventType === 'bonus_delivery_failed'
            ? 'failed'
            : latestBonusEvent?.eventType === 'bonus_delivery_attempted'
              ? 'attempted'
              : 'not_started',
        events: bonusEvents.map(({ id, eventType, occurredAt, metadata }) => ({ id, eventType, occurredAt, metadata })),
      },
      webinar: {
        webinarId: webinar?.id ?? null,
        maxProgress: progressEvent ? Number(progressEvent.eventType.split('_')[1]) : 0,
        events: webinarEvents.map(({ id, eventType, occurredAt, metadata }) => ({ id, eventType, occurredAt, metadata })),
      },
      application,
      applicationStatus: application?.status ?? null,
      messaging: {
        promotional: user.promotionalEnabled !== false,
        stopRequestedAt: user.stopRequestedAt,
      },
      deletionRequest: await store.getDataDeletionRequest({ userId: user.id, funnelId: user.funnelId }),
      events: events.map(({ id, eventType, occurredAt, metadata, idempotencyKey }) => ({ id, eventType, occurredAt, metadata, idempotencyKey })),
      lastEventAt: user.lastEventAt,
    };
  }

  return {
    handleTelegramStart,
    createWebinarSession,
    openWebinarPage,
    authorizeWebinarMedia,
    ingestWebinarTelemetry,
    recordWebinarCta,
    recordApplicationStarted,
    recordTokenEvent,
    createApplicationToken,
    submitApplication,
    stopTelegramFlow,
    requestDataDeletion,
    canSendPromotional: async (userId) => (await store.getUser(userId))?.promotionalEnabled === true,
    leadDetails,
    dashboard: (funnelId = FUNNEL_ID) => store.dashboard(funnelId),
    warmingConfig: (funnelId = FUNNEL_ID) => store.listAutomationRules(funnelId),
    runDeliveryRecovery: (options) => recoveryExecutor.run(options),
    runWarmingScheduler: (options) => warmingScheduler.run(options),
    exceptionalDeliveries: (funnelId = FUNNEL_ID) => store.listExceptionalDeliveryOperations({ funnelId }),
  };
}
