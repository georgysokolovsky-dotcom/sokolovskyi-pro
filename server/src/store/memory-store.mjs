import { randomUUID } from 'node:crypto';

const clone = (value) => value == null ? value : structuredClone(value);

export class MemoryStore {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.funnels = new Map();
    this.sources = new Map();
    this.bonuses = new Map();
    this.messageTemplates = new Map();
    this.automationRules = new Map();
    this.webinars = new Map();
    this.users = new Map();
    this.telegramUsers = new Map();
    this.telegramUpdates = new Map();
    this.events = [];
    this.eventKeys = new Set();
    this.applications = new Map();
    this.applicationKeys = new Map();
    this.deletionRequests = new Map();
    this.deliveryOperations = new Map();
  }

  seed({ funnel, sources = [], bonuses = [], messageTemplates = [], automationRules = [], webinar }) {
    this.funnels.set(funnel.id, clone(funnel));
    for (const source of sources) this.sources.set(source.id, clone(source));
    for (const bonus of bonuses) this.bonuses.set(bonus.id, clone(bonus));
    for (const template of messageTemplates) this.messageTemplates.set(template.id, clone(template));
    for (const rule of automationRules) this.automationRules.set(rule.id, clone(rule));
    if (webinar) this.webinars.set(webinar.id, clone(webinar));
  }

  getFunnel(funnelId) {
    return clone(this.funnels.get(funnelId) ?? null);
  }

  findSourceByStartParameter(funnelId, startParameter) {
    return [...this.sources.values()].find((source) => source.funnelId === funnelId && source.startParameter === startParameter) ?? null;
  }

  findSourceById(sourceId) {
    return this.sources.get(sourceId) ?? null;
  }

  findBonusForSource(funnelId, sourceId) {
    return [...this.bonuses.values()].find((bonus) => bonus.funnelId === funnelId && bonus.sourceId === sourceId && bonus.status === 'active') ?? null;
  }

  findBonusForFunnel(funnelId, useCase = 'entry') {
    return [...this.bonuses.values()].find((bonus) => bonus.funnelId === funnelId && bonus.sourceId == null && bonus.useCase === useCase && bonus.status === 'active') ?? null;
  }

  findMessageTemplate(funnelId, name) {
    return [...this.messageTemplates.values()].find((template) => template.funnelId === funnelId && template.name === name && template.status === 'active') ?? null;
  }

  findWebinarForFunnel(funnelId) {
    return clone([...this.webinars.values()].find((item) => item.funnelId === funnelId) ?? null);
  }

  listAutomationRules(funnelId) {
    return clone([...this.automationRules.values()].filter((rule) => rule.funnelId === funnelId && rule.status === 'active'));
  }

  findUserByTelegramId(telegramUserId) {
    const record = [...this.telegramUsers.values()].find((item) => String(item.telegramUserId) === String(telegramUserId));
    return record ? this.users.get(record.userId) ?? null : null;
  }

  createUser({ funnelId, sourceId = null, anonymousSessionId = null, firstTouch = null, funnelEntryTouch = null, entryNotice = null, leadStatus = 'anonymous' }) {
    const now = this.now().toISOString();
    const user = {
      id: randomUUID(),
      funnelId,
      sourceId,
      anonymousSessionId,
      firstTouch: clone(firstTouch),
      funnelEntryTouch: clone(funnelEntryTouch),
      entryNotice: clone(entryNotice),
      promotionalEnabled: true,
      stopRequestedAt: null,
      deletionRequestedAt: null,
      leadStatus,
      firstContactAt: now,
      lastEventAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return clone(user);
  }

  updateUser(userId, patch) {
    const current = this.users.get(userId);
    if (!current) return null;
    const updated = { ...current, ...patch, updatedAt: this.now().toISOString() };
    this.users.set(userId, updated);
    return clone(updated);
  }

  getUser(userId) {
    return clone(this.users.get(userId) ?? null);
  }

  setPromotionalEnabled(userId, enabled, stoppedAt = null) {
    return this.updateUser(userId, {
      promotionalEnabled: Boolean(enabled),
      stopRequestedAt: enabled ? null : stoppedAt,
    });
  }

  upsertTelegramUser({ userId, telegramUserId, telegramChatId = telegramUserId, firstName = null, username = null, languageCode = null }) {
    const existing = this.telegramUsers.get(userId);
    const now = this.now().toISOString();
    const record = {
      userId,
      telegramUserId: String(telegramUserId),
      telegramChatId: String(telegramChatId),
      firstName,
      username,
      languageCode,
      firstStartedAt: existing?.firstStartedAt ?? now,
      lastStartedAt: now,
      channelStatus: existing?.channelStatus ?? 'unknown',
      unsubscribedAt: existing?.unsubscribedAt ?? null,
    };
    this.telegramUsers.set(userId, record);
    return clone(record);
  }

  getTelegramUser(userId) {
    return clone(this.telegramUsers.get(userId) ?? null);
  }

  requestDataDeletion({ userId, funnelId }) {
    const key = `${funnelId}:${userId}`;
    const existing = this.deletionRequests.get(key);
    if (existing) return clone(existing);
    const request = {
      id: randomUUID(),
      userId,
      funnelId,
      status: 'requested',
      requestedAt: this.now().toISOString(),
      processedAt: null,
    };
    this.deletionRequests.set(key, request);
    this.updateUser(userId, { deletionRequestedAt: request.requestedAt });
    return clone(request);
  }

  getDataDeletionRequest({ userId, funnelId }) {
    return clone(this.deletionRequests.get(`${funnelId}:${userId}`) ?? null);
  }

  addEvent({ userId = null, anonymousSessionId = null, funnelId, eventType, metadata = {}, idempotencyKey = null }) {
    const key = idempotencyKey ? `${funnelId}:${idempotencyKey}` : null;
    if (key && this.eventKeys.has(key)) {
      return { event: clone(this.events.find((item) => `${item.funnelId}:${item.idempotencyKey}` === key)), duplicate: true };
    }
    const event = {
      id: randomUUID(),
      userId,
      anonymousSessionId,
      funnelId,
      eventType,
      occurredAt: this.now().toISOString(),
      metadata: clone(metadata),
      idempotencyKey,
    };
    this.events.push(event);
    if (key) this.eventKeys.add(key);
    if (userId) this.updateUser(userId, { lastEventAt: event.occurredAt });
    return { event: clone(event), duplicate: false };
  }

  findEventByIdempotencyKey(funnelId, idempotencyKey) {
    if (!idempotencyKey) return null;
    return clone(this.events.find((event) => event.funnelId === funnelId && event.idempotencyKey === idempotencyKey) ?? null);
  }

  claimTelegramStart({ source, telegramUserId, telegramChatId, firstName, username, languageCode, firstTouch, funnelEntryTouch, eventMetadata, eventKey, updateId, occurredAt }) {
    const updateKey = updateId == null ? null : `${source.funnelId}:${updateId}`;
    if (updateKey && this.telegramUpdates.has(updateKey)) {
      const update = this.telegramUpdates.get(updateKey);
      return { user: this.getUser(update.userId), event: this.findEventByIdempotencyKey(source.funnelId, eventKey), duplicate: true, updateStatus: update.status };
    }
    if (updateKey) this.telegramUpdates.set(updateKey, { funnelId: source.funnelId, updateId: String(updateId), userId: null, sourceId: source.id, status: 'processing', receivedAt: occurredAt, processingStartedAt: occurredAt, completedAt: null, failedAt: null, errorStage: null, errorCode: null });
    const existing = this.findUserByTelegramId(telegramUserId);
    const user = existing ?? this.createUser({ funnelId: source.funnelId, sourceId: firstTouch.sourceId, firstTouch, funnelEntryTouch, leadStatus: 'telegram_lead' });
    if (existing) this.updateUser(user.id, { sourceId: existing.firstTouch?.sourceId ?? existing.sourceId ?? firstTouch.sourceId, firstTouch: existing.firstTouch ?? firstTouch, funnelEntryTouch: existing.funnelEntryTouch ?? funnelEntryTouch });
    this.upsertTelegramUser({ userId: user.id, telegramUserId, telegramChatId, firstName, username, languageCode });
    const event = this.addEvent({ userId: user.id, funnelId: source.funnelId, eventType: 'telegram_start', metadata: eventMetadata, idempotencyKey: eventKey });
    if (updateKey) this.telegramUpdates.get(updateKey).userId = user.id;
    return { user: this.getUser(user.id), event: event.event, duplicate: event.duplicate, updateStatus: 'processing' };
  }

  finishTelegramUpdate({ funnelId, updateId, status, errorStage = null, errorCode = null }) {
    if (updateId == null) return;
    const update = this.telegramUpdates.get(`${funnelId}:${updateId}`);
    if (!update) return;
    update.status = status;
    update.errorStage = errorStage;
    update.errorCode = errorCode;
    if (status === 'completed') update.completedAt = this.now().toISOString();
    if (status === 'failed') update.failedAt = this.now().toISOString();
  }

  getTelegramUpdate(funnelId, updateId) {
    return clone(this.telegramUpdates.get(`${funnelId}:${updateId}`) ?? null);
  }

  createDeliveryOperation({ operationKey, funnelId, userId, telegramUpdateId = null, telegramChatId, messageType, dependsOnOperationId = null, descriptor = {}, maxAttempts = 3 }) {
    const existing = [...this.deliveryOperations.values()].find((item) => item.funnelId === funnelId && item.operationKey === operationKey);
    if (existing) return clone(existing);
    const timestamp = this.now().toISOString();
    const operation = {
      id: randomUUID(), operationKey, funnelId, userId,
      telegramUpdateId: telegramUpdateId == null ? null : String(telegramUpdateId),
      telegramChatId: String(telegramChatId), messageType, dependsOnOperationId, descriptor: clone(descriptor),
      status: 'pending', attemptCount: 0, maxAttempts, nextAttemptAt: timestamp,
      leaseOwner: null, leaseStartedAt: null, leaseExpiresAt: null, requestStartedAt: null,
      provider: null, providerMessageId: null, deliveredAt: null,
      lastErrorCode: null, lastErrorCategory: null, createdAt: timestamp, updatedAt: timestamp,
    };
    this.deliveryOperations.set(operation.id, operation);
    return clone(operation);
  }

  getDeliveryOperation(operationId) { return clone(this.deliveryOperations.get(operationId) ?? null); }

  listDeliveryOperations({ userId = null, status = null } = {}) {
    return clone([...this.deliveryOperations.values()].filter((item) => (!userId || item.userId === userId) && (!status || item.status === status)));
  }

  claimDeliveryOperation({ workerId, leaseMs, operationId = null, now = this.now().toISOString() }) {
    const nowMs = new Date(now).getTime();
    for (const item of this.deliveryOperations.values()) {
      if (item.status === 'processing' && new Date(item.leaseExpiresAt).getTime() <= nowMs && item.requestStartedAt) {
        Object.assign(item, { status: 'delivery_unknown', lastErrorCode: 'lease_expired_after_request', lastErrorCategory: 'unknown', leaseOwner: null, leaseStartedAt: null, leaseExpiresAt: null, updatedAt: now });
      }
    }
    const operation = [...this.deliveryOperations.values()].find((item) => {
      if (operationId && item.id !== operationId) return false;
      if (item.dependsOnOperationId && this.deliveryOperations.get(item.dependsOnOperationId)?.status !== 'delivered') return false;
      if (['pending', 'retryable_failed'].includes(item.status)) return new Date(item.nextAttemptAt).getTime() <= nowMs;
      return item.status === 'processing' && new Date(item.leaseExpiresAt).getTime() <= nowMs && !item.requestStartedAt;
    });
    if (!operation) return null;
    Object.assign(operation, { status: 'processing', leaseOwner: workerId, leaseStartedAt: now, leaseExpiresAt: new Date(nowMs + leaseMs).toISOString(), requestStartedAt: null, updatedAt: now });
    return clone(operation);
  }

  markDeliveryAttemptStarted({ operationId, workerId }) {
    const operation = this.deliveryOperations.get(operationId);
    if (!operation || operation.status !== 'processing' || operation.leaseOwner !== workerId || operation.requestStartedAt) return null;
    operation.attemptCount += 1;
    operation.requestStartedAt = this.now().toISOString();
    operation.updatedAt = operation.requestStartedAt;
    return clone(operation);
  }

  finishDeliveryOperation({ operationId, workerId, status, provider = null, providerMessageId = null, errorCode = null, errorCategory = null, nextAttemptAt = null, outcome = null }) {
    const operation = this.deliveryOperations.get(operationId);
    if (!operation || operation.status !== 'processing' || operation.leaseOwner !== workerId) return clone(operation ?? null);
    const timestamp = this.now().toISOString();
    Object.assign(operation, {
      status, provider, providerMessageId,
      deliveredAt: status === 'delivered' ? timestamp : null,
      lastErrorCode: errorCode, lastErrorCategory: errorCategory,
      nextAttemptAt: nextAttemptAt ?? operation.nextAttemptAt,
      leaseOwner: null, leaseStartedAt: null, leaseExpiresAt: null,
      requestStartedAt: status === 'retryable_failed' ? null : operation.requestStartedAt,
      updatedAt: timestamp,
    });
    if (status === 'suppressed') {
      for (const dependent of this.deliveryOperations.values()) {
        if (dependent.funnelId === operation.funnelId && dependent.userId === operation.userId && ['pending', 'retryable_failed'].includes(dependent.status)) {
          Object.assign(dependent, { status: 'suppressed', lastErrorCode: errorCode, lastErrorCategory: 'permanent', updatedAt: timestamp });
        }
      }
    }
    if (outcome?.userPatch) this.updateUser(operation.userId, outcome.userPatch);
    if (outcome?.event) this.addEvent(outcome.event);
    return clone(operation);
  }

  listUserEvents(userId) {
    return clone(this.events.filter((event) => event.userId === userId));
  }

  createApplication({ userId, funnelId, answers, consent, idempotencyKey }) {
    if (idempotencyKey && this.applicationKeys.has(idempotencyKey)) {
      return { application: clone(this.applications.get(this.applicationKeys.get(idempotencyKey))), duplicate: true };
    }
    const now = this.now().toISOString();
    const application = {
      id: randomUUID(),
      userId,
      funnelId,
      status: 'submitted',
      answers: clone(answers),
      privacyPolicyVersion: consent.policyVersion,
      consent: clone(consent),
      createdAt: now,
      updatedAt: now,
    };
    this.applications.set(application.id, application);
    if (idempotencyKey) this.applicationKeys.set(idempotencyKey, application.id);
    return { application: clone(application), duplicate: false };
  }

  createApplicationWithEvent(args) {
    const result = this.createApplication(args);
    if (!result.duplicate) {
      this.addEvent({ userId: args.userId, funnelId: args.funnelId, eventType: 'application_submitted', metadata: { purpose: 'application' }, idempotencyKey: `application-event:${result.application.id}` });
      this.updateUser(args.userId, { leadStatus: 'application_submitted' });
    }
    return result;
  }

  getApplicationForUser(userId) {
    return clone([...this.applications.values()].find((application) => application.userId === userId) ?? null);
  }

  dashboard(funnelId) {
    const inFunnel = this.events.filter((event) => event.funnelId === funnelId);
    const count = (eventType) => new Set(inFunnel.filter((event) => event.eventType === eventType).map((event) => event.userId ?? event.anonymousSessionId ?? event.id)).size;
    return {
      funnelId,
      visitors: count('article_view'),
      telegramStarts: count('telegram_start'),
      bonusDeliveryAttempts: count('bonus_delivery_attempted'),
      bonusSent: count('bonus_sent'),
      bonusDeliveryFailed: count('bonus_delivery_failed'),
      webinarStarted: count('webinar_started'),
      watched25: count('watched_25'),
      watched50: count('watched_50'),
      watched75: count('watched_75'),
      ctaClicks: count('cta_clicked'),
      applications: this.events.filter((event) => event.funnelId === funnelId && event.eventType === 'application_submitted').length,
      users: [...this.users.values()].filter((user) => user.funnelId === funnelId).length,
    };
  }
}
