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

const sourcePattern = /^[a-z0-9_-]{1,64}$/i;
const maxTextLength = 2000;
const maxNameLength = 200;
const tokenTtlSeconds = 60 * 60;
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
  if (['watched_25', 'watched_50', 'watched_75', 'watched_90', 'webinar_completed'].includes(eventType)) return 'webinar_engaged';
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

function buildTemplateMessage(template, { role = template?.role, bonus = null, webinarUrl = null } = {}) {
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
}) {
  if (!store) throw new Error('store is required');
  if (!transport || typeof transport.sendMessage !== 'function') throw new Error('transport.sendMessage is required');

  function resolveToken(token, purpose) {
    const result = verifyFunnelToken(token, { purpose, secret: signingSecret });
    if (!result.ok) throw new FunnelError(result.code, 'Invalid or expired funnel token', 401);
    const user = store.getUser(result.payload.user_ref);
    if (!user || user.funnelId !== result.payload.funnel_id) {
      throw new FunnelError('invalid_token', 'Invalid funnel token', 401);
    }
    return { user, payload: result.payload };
  }

  function issueToken({ user, purpose }) {
    const token = signFunnelToken({
      purpose,
      userRef: user.id,
      funnelId: user.funnelId,
      ttlSeconds: tokenTtlSeconds,
      secret: signingSecret,
    });
    const issuedAt = Math.floor(Date.now() / 1000);
    return {
      token,
      purpose,
      expiresInSeconds: tokenTtlSeconds,
      expiresAt: new Date((issuedAt + tokenTtlSeconds) * 1000).toISOString(),
    };
  }

  function issueWebinarToken(user) {
    const webinar = [...store.webinars.values()].find((item) => item.funnelId === user.funnelId);
    const token = issueToken({ user, purpose: 'webinar' });
    const configuredBase = typeof webinarBaseUrl === 'string' && webinarBaseUrl.trim()
      ? webinarBaseUrl.trim().replace(/\/+$/, '')
      : null;
    const videoReference = webinar?.videoUrl
      ?? (configuredBase
        ? `${configuredBase}/${encodeURIComponent(webinar?.videoId ?? 'unconfigured')}`
        : `lab://men-funnel/video/${encodeURIComponent(webinar?.videoId ?? 'unconfigured')}`);
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

  function recordUserEvent({ userId, funnelId, eventType, metadata = {}, idempotencyKey = null }) {
    if (!FUNNEL_EVENTS.includes(eventType)) throw new FunnelError('invalid_event', 'Unsupported event type');
    const current = store.getUser(userId);
    if (!current || current.funnelId !== funnelId) throw new FunnelError('not_found', 'User not found', 404);
    const result = store.addEvent({
      userId,
      funnelId,
      eventType,
      metadata: safeEventMetadata(metadata),
      idempotencyKey,
    });
    if (!result.duplicate) {
      const transition = transitionForEvent(eventType);
      if (transition) store.updateUser(userId, { leadStatus: transition });
      if (eventType === 'telegram_stop') {
        store.setPromotionalEnabled(userId, false, result.event.occurredAt);
      }
      if (eventType === 'data_deletion_requested') {
        store.requestDataDeletion({ userId, funnelId });
      }
    }
    return { ...result, status: store.getUser(userId).leadStatus };
  }

  function bonusDeliveryStatus(userId, bonusId) {
    const events = store.listUserEvents(userId).filter((event) => event.metadata?.bonus_id === bonusId);
    const sent = events.find((event) => event.eventType === 'bonus_sent');
    if (sent) return { status: 'sent', event: sent };
    const failed = [...events].reverse().find((event) => event.eventType === 'bonus_delivery_failed');
    if (failed) return { status: 'failed', event: failed };
    const attempted = [...events].reverse().find((event) => event.eventType === 'bonus_delivery_attempted');
    if (attempted) return { status: 'attempted', event: attempted };
    return { status: 'not_started', event: null };
  }

  function webinarInviteDeliveryStatus(userId) {
    const events = store.listUserEvents(userId);
    const sent = events.find((event) => event.eventType === 'webinar_invite_sent');
    if (sent) return { status: 'sent', event: sent };
    const failed = [...events].reverse().find((event) => event.eventType === 'webinar_invite_delivery_failed');
    if (failed) return { status: 'failed', event: failed };
    const attempted = [...events].reverse().find((event) => event.eventType === 'webinar_invite_delivery_attempted');
    if (attempted) return { status: 'attempted', event: attempted };
    return { status: 'not_started', event: null };
  }

  async function sendTransportMessage({ user, message, bonus = null }) {
    return transport.sendMessage({
      userId: user.id,
      funnelId: user.funnelId,
      telegramChatId: store.getTelegramUser(user.id)?.telegramUserId,
      message,
      bonus,
    });
  }

  async function deliverEntryNotice({ user, source, message, occurredAt }) {
    const previous = store.listUserEvents(user.id).find((event) => event.eventType === 'funnel_entry_notice_presented');
    if (previous) return { status: 'sent', event: previous, duplicate: true };
    try {
      const result = await sendTransportMessage({ user, message });
      const notice = { ...entryNotice, funnelId: source.funnelId, timestamp: occurredAt };
      store.updateUser(user.id, { entryNotice: notice, leadStatus: 'telegram_lead' });
      const presented = store.addEvent({
        userId: user.id,
        funnelId: source.funnelId,
        eventType: 'funnel_entry_notice_presented',
        metadata: {
          ...sourceMetadata(source),
          consent_or_request_version: entryNotice.version,
          source: entryNotice.source,
          provider: result.provider,
          provider_message_id: result.messageId,
          template_id: message.templateId,
          template_version: message.templateVersion,
        },
        idempotencyKey: `entry-notice:${user.id}:${source.funnelId}`,
      });
      return { status: 'sent', event: presented.event, provider: result.provider, providerMessageId: result.messageId };
    } catch (error) {
      return { status: 'failed', event: null, errorCode: error.code ?? 'transport_failed' };
    }
  }

  async function deliverBonus({ user, bonus, message }) {
    if (!bonus) return { status: 'not_configured', event: null };
    const previous = bonusDeliveryStatus(user.id, bonus.id);
    if (previous.status === 'sent') return { status: 'sent', event: previous.event, duplicate: true };

    const attempts = store.listUserEvents(user.id).filter((event) => event.eventType === 'bonus_delivery_attempted' && event.metadata?.bonus_id === bonus.id);
    const attemptNumber = attempts.length + 1;
    const attemptKey = `bonus-attempt:${user.id}:${bonus.id}:${bonus.version}:${attemptNumber}`;
    const attempted = store.addEvent({
      userId: user.id,
      funnelId: user.funnelId,
      eventType: 'bonus_delivery_attempted',
      metadata: {
        bonus_id: bonus.id,
        bonus_version: bonus.version,
        attempt_number: attemptNumber,
      },
      idempotencyKey: attemptKey,
    });
    if (attempted.duplicate) return { status: 'attempted', event: attempted.event, duplicate: true };

    try {
      const result = await sendTransportMessage({ user, bonus, message });
      const sent = store.addEvent({
        userId: user.id,
        funnelId: user.funnelId,
        eventType: 'bonus_sent',
        metadata: {
          bonus_id: bonus.id,
          bonus_version: bonus.version,
          provider: result.provider,
          provider_message_id: result.messageId,
        },
        idempotencyKey: `bonus-sent:${user.id}:${bonus.id}:${bonus.version}`,
      });
      return { status: 'sent', event: sent.event, duplicate: sent.duplicate, provider: result.provider, providerMessageId: result.messageId };
    } catch (error) {
      const failed = store.addEvent({
        userId: user.id,
        funnelId: user.funnelId,
        eventType: 'bonus_delivery_failed',
        metadata: {
          bonus_id: bonus.id,
          bonus_version: bonus.version,
          attempt_number: attemptNumber,
          provider: transport.provider ?? 'unknown',
        },
        idempotencyKey: `bonus-failed:${user.id}:${bonus.id}:${bonus.version}:${attemptNumber}`,
      });
      return { status: 'failed', event: failed.event, errorCode: error.code ?? 'transport_failed' };
    }
  }

  async function deliverWebinarInvite({ user, message }) {
    const previous = webinarInviteDeliveryStatus(user.id);
    if (previous.status === 'sent') return { status: 'sent', event: previous.event, duplicate: true };

    const attempts = store.listUserEvents(user.id).filter((event) => event.eventType === 'webinar_invite_delivery_attempted');
    const attemptNumber = attempts.length + 1;
    const attempted = store.addEvent({
      userId: user.id,
      funnelId: user.funnelId,
      eventType: 'webinar_invite_delivery_attempted',
      metadata: {
        attempt_number: attemptNumber,
        purpose: 'webinar',
        template_id: message.templateId,
        template_version: message.templateVersion,
      },
      idempotencyKey: `webinar-invite-attempt:${user.id}:${message.templateId}:${message.templateVersion}:${attemptNumber}`,
    });
    if (attempted.duplicate) return { status: 'attempted', event: attempted.event, duplicate: true };

    try {
      const result = await sendTransportMessage({ user, message });
      const sent = store.addEvent({
        userId: user.id,
        funnelId: user.funnelId,
        eventType: 'webinar_invite_sent',
        metadata: {
          purpose: 'webinar',
          provider: result.provider,
          provider_message_id: result.messageId,
          template_id: message.templateId,
          template_version: message.templateVersion,
        },
        idempotencyKey: `webinar-invite-sent:${user.id}:${message.templateId}:${message.templateVersion}`,
      });
      return { status: 'sent', event: sent.event, provider: result.provider, providerMessageId: result.messageId };
    } catch (error) {
      const failed = store.addEvent({
        userId: user.id,
        funnelId: user.funnelId,
        eventType: 'webinar_invite_delivery_failed',
        metadata: {
          attempt_number: attemptNumber,
          purpose: 'webinar',
          provider: transport.provider ?? 'unknown',
          template_id: message.templateId,
          template_version: message.templateVersion,
        },
        idempotencyKey: `webinar-invite-failed:${user.id}:${message.templateId}:${message.templateVersion}:${attemptNumber}`,
      });
      return { status: 'failed', event: failed.event, errorCode: error.code ?? 'transport_failed' };
    }
  }

  async function handleTelegramStart({ telegramUserId, firstName = null, username = null, languageCode = null, startParameter, updateId = null, timestamp = null }) {
    if (telegramUserId == null) throw new FunnelError('invalid_input', 'telegramUserId is required');
    if (!sourcePattern.test(startParameter ?? '')) throw new FunnelError('invalid_start_parameter', 'Invalid start parameter');
    let source = store.findSourceByStartParameter(FUNNEL_ID, startParameter);
    if (!source) throw new FunnelError('unknown_source', 'Unknown start parameter', 404);

    const occurredAt = timestamp ?? new Date().toISOString();
    const eventKey = updateId == null ? `telegram-start:${telegramUserId}:${startParameter}` : `telegram-update:${updateId}`;
    const previousStartEvent = store.findEventByIdempotencyKey(source.funnelId, eventKey);
    let user;
    let startEvent;

    if (previousStartEvent) {
      user = store.getUser(previousStartEvent.userId);
      source = store.findSourceById(previousStartEvent.metadata?.source_id) ?? source;
      startEvent = { event: previousStartEvent, duplicate: true };
    } else {
      const existing = store.findUserByTelegramId(telegramUserId);
      const firstTouch = existing?.firstTouch ?? buildTouch(source, occurredAt);
      const funnelEntryTouch = existing?.funnelEntryTouch ?? buildTouch(source, occurredAt);
      user = existing ?? store.createUser({
        funnelId: source.funnelId,
        sourceId: firstTouch.sourceId,
        firstTouch,
        funnelEntryTouch,
        leadStatus: 'telegram_lead',
      });
      if (existing) {
        store.updateUser(user.id, {
          sourceId: existing.firstTouch?.sourceId ?? existing.sourceId ?? firstTouch.sourceId,
          firstTouch,
          funnelEntryTouch,
        });
      }
      store.upsertTelegramUser({ userId: user.id, telegramUserId, firstName, username, languageCode });
      startEvent = store.addEvent({
        userId: user.id,
        funnelId: source.funnelId,
        eventType: 'telegram_start',
        metadata: sourceMetadata(source),
        idempotencyKey: eventKey,
      });
    }

    const activeUser = store.getUser(user.id);
    const bonus = store.findBonusForFunnel(activeUser.funnelId, 'entry');
    if (bonus && !BONUS_DELIVERY_MODES.includes(bonus.deliveryMode)) {
      throw new FunnelError('invalid_bonus_config', 'Invalid bonus delivery mode', 500);
    }
    const noticeMessage = buildTemplateMessage(store.findMessageTemplate(activeUser.funnelId, 'entry_notice'));
    const bonusMessage = buildTemplateMessage(
      store.findMessageTemplate(activeUser.funnelId, 'podcast_bonus_intro'),
      { role: 'bonus', bonus },
    );
    const webinarTemplate = store.findMessageTemplate(activeUser.funnelId, 'webinar_invite');
    if (!noticeMessage || !bonus || !bonusMessage || !webinarTemplate) {
      throw new FunnelError('invalid_message_config', 'Telegram message plan is incomplete', 500);
    }

    const messagePlan = [noticeMessage, bonusMessage];
    const previousNotice = store.listUserEvents(activeUser.id).find((event) => event.eventType === 'funnel_entry_notice_presented');
    let noticeDelivery = previousNotice
      ? { status: 'sent', event: previousNotice, duplicate: true }
      : { status: 'not_started', event: null };
    let bonusDelivery = bonusDeliveryStatus(activeUser.id, bonus.id);
    let webinarInviteDelivery = webinarInviteDeliveryStatus(activeUser.id);
    let webinar = null;

    if (!startEvent.duplicate) {
      noticeDelivery = await deliverEntryNotice({ user: activeUser, source, message: noticeMessage, occurredAt });
      if (noticeDelivery.status === 'sent') {
        bonusDelivery = await deliverBonus({ user: activeUser, bonus, message: bonusMessage });
      }
    }

    if (bonusDelivery.status === 'sent') {
      webinar = issueWebinarToken(activeUser);
      const webinarMessage = buildTemplateMessage(webinarTemplate, { role: 'webinar_invite', webinarUrl: webinar.url });
      messagePlan.push(webinarMessage);
      if (!startEvent.duplicate) {
        webinarInviteDelivery = await deliverWebinarInvite({ user: activeUser, message: webinarMessage });
      }
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

  function createWebinarSession(token) {
    const { user, payload } = resolveToken(token, 'webinar');
    const webinar = [...store.webinars.values()].find((item) => item.funnelId === user.funnelId);
    return {
      userId: user.id,
      funnelId: payload.funnel_id,
      purpose: payload.purpose,
      webinar: webinar ? { id: webinar.id, route: webinar.route, videoProvider: webinar.videoProvider, videoId: webinar.videoId, videoUrl: webinar.videoUrl } : null,
    };
  }

  function recordTokenEvent({ token, eventType, metadata, idempotencyKey }) {
    const purpose = WEBINAR_EVENTS.includes(eventType)
      ? 'webinar'
      : ['application_started', 'application_submitted'].includes(eventType)
        ? 'application'
        : null;
    if (!purpose) throw new FunnelError('invalid_event', 'Unsupported token event');
    const { user } = resolveToken(token, purpose);
    return recordUserEvent({ userId: user.id, funnelId: user.funnelId, eventType, metadata, idempotencyKey });
  }

  function createApplicationToken({ token }) {
    const { user } = resolveToken(token, 'webinar');
    const hasCta = store.listUserEvents(user.id).some((event) => event.eventType === 'cta_clicked');
    if (!hasCta) throw new FunnelError('cta_required', 'Webinar CTA is required', 409);
    return issueApplicationToken(user);
  }

  function submitApplication({ token, answers, consent, idempotencyKey }) {
    const { user } = resolveToken(token, 'application');
    const cleanAnswers = sanitizeAnswers(answers);
    const cleanConsent = assertConsent(consent);
    const result = store.createApplication({ userId: user.id, funnelId: user.funnelId, answers: cleanAnswers, consent: cleanConsent, idempotencyKey });
    if (!result.duplicate) {
      recordUserEvent({
        userId: user.id,
        funnelId: user.funnelId,
        eventType: 'application_submitted',
        metadata: { purpose: 'application' },
        idempotencyKey: `application-event:${result.application.id}`,
      });
    }
    return { ...result, userId: user.id };
  }

  function stopTelegramFlow({ telegramUserId, idempotencyKey = null }) {
    const user = store.findUserByTelegramId(telegramUserId);
    if (!user) throw new FunnelError('not_found', 'Telegram user not found', 404);
    return recordUserEvent({
      userId: user.id,
      funnelId: user.funnelId,
      eventType: 'telegram_stop',
      metadata: {},
      idempotencyKey: idempotencyKey ?? `telegram-stop:${user.id}`,
    });
  }

  function requestDataDeletion({ telegramUserId, idempotencyKey = null }) {
    const user = store.findUserByTelegramId(telegramUserId);
    if (!user) throw new FunnelError('not_found', 'Telegram user not found', 404);
    const result = recordUserEvent({
      userId: user.id,
      funnelId: user.funnelId,
      eventType: 'data_deletion_requested',
      metadata: {},
      idempotencyKey: idempotencyKey ?? `data-deletion:${user.id}`,
    });
    return { ...result, request: store.getDataDeletionRequest({ userId: user.id, funnelId: user.funnelId }) };
  }

  function leadDetails(userId) {
    const user = store.getUser(userId);
    if (!user) throw new FunnelError('not_found', 'Lead not found', 404);
    const events = store.listUserEvents(user.id);
    const webinarEvents = events.filter((event) => WEBINAR_EVENTS.includes(event.eventType));
    const progressEvent = [...['watched_90', 'watched_75', 'watched_50', 'watched_25']]
      .map((eventType) => webinarEvents.find((event) => event.eventType === eventType))
      .find(Boolean);
    const bonusEvents = events.filter((event) => ['bonus_delivery_attempted', 'bonus_sent', 'bonus_delivery_failed'].includes(event.eventType));
    const latestBonusEvent = bonusEvents.at(-1) ?? null;
    const application = store.getApplicationForUser(user.id);
    const firstTouch = user.firstTouch ?? (user.sourceId ? buildTouch(store.findSourceById(user.sourceId), user.createdAt) : null);
    return {
      id: user.id,
      funnelId: user.funnelId,
      leadStatus: user.leadStatus,
      source: user.sourceId ? store.findSourceById(user.sourceId) : null,
      attribution: {
        first_touch: firstTouch,
        funnel_entry_touch: user.funnelEntryTouch,
        article_slug: user.funnelEntryTouch?.articleSlug ?? null,
        funnel_id: user.funnelId,
      },
      entryNotice: user.entryNotice,
      telegram: store.getTelegramUser(user.id),
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
        webinarId: [...store.webinars.values()].find((item) => item.funnelId === user.funnelId)?.id ?? null,
        maxProgress: progressEvent ? Number(progressEvent.eventType.split('_')[1]) : 0,
        events: webinarEvents.map(({ id, eventType, occurredAt, metadata }) => ({ id, eventType, occurredAt, metadata })),
      },
      application,
      applicationStatus: application?.status ?? null,
      messaging: {
        promotional: user.promotionalEnabled !== false,
        stopRequestedAt: user.stopRequestedAt,
      },
      deletionRequest: store.getDataDeletionRequest({ userId: user.id, funnelId: user.funnelId }),
      events: events.map(({ id, eventType, occurredAt, metadata, idempotencyKey }) => ({ id, eventType, occurredAt, metadata, idempotencyKey })),
      lastEventAt: user.lastEventAt,
    };
  }

  return {
    handleTelegramStart,
    createWebinarSession,
    recordTokenEvent,
    createApplicationToken,
    submitApplication,
    stopTelegramFlow,
    requestDataDeletion,
    canSendPromotional: (userId) => store.getUser(userId)?.promotionalEnabled === true,
    leadDetails,
    dashboard: (funnelId = FUNNEL_ID) => store.dashboard(funnelId),
    warmingConfig: (funnelId = FUNNEL_ID) => store.listAutomationRules(funnelId),
  };
}
