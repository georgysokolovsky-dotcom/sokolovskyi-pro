import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { FUNNEL_EVENTS } from '../src/constants.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createApp } from '../src/http/app.mjs';
import { createDevTelegramTransport } from '../src/telegram/transport.mjs';

const signingSecret = 'test-signing-secret';
const webhookSecret = 'test-webhook-secret';
const adminKey = 'test-admin-key';

async function makeTestServer({ transport } = {}) {
  const clock = { value: new Date() };
  const store = new MemoryStore({ now: () => clock.value });
  store.seed(localFixture);
  const flow = createMenWebinarFlow({
    store,
    signingSecret,
    botUsername: 'sokolovskyi_men_bot',
    entryNotice: localFixture.entryNotice,
    transport: transport ?? createDevTelegramTransport(),
    now: () => clock.value,
  });
  const app = createApp({ flow, mode: 'local', webhookSecret, adminKey });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const address = app.address();
  return { app, flow, store, clock, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function request(server, path, options = {}) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  return { response, body: await response.json() };
}

async function start(server, { telegramUserId, startParameter = 'article_wife_cheating', updateId = null } = {}) {
  return request(server, '/v1/test/telegram/start', {
    method: 'POST',
    body: JSON.stringify({
      telegramUserId,
      firstName: 'Тест',
      username: `fixture_${telegramUserId}`,
      languageCode: 'ru',
      startParameter,
      updateId,
      timestamp: '2026-09-08T10:00:00.000Z',
    }),
  });
}

async function event(server, token, eventType, idempotencyKey, metadata = {}) {
  const path = eventType === 'cta_clicked' ? '/v1/webinar/cta' : '/v1/applications/events';
  return request(server, path, {
    method: 'POST',
    body: JSON.stringify({ token, requestId: idempotencyKey }),
  });
}

async function telemetry(server, token, clientSessionId, action, positionSeconds, requestId = randomUUID()) {
  return request(server, '/v1/webinar/telemetry', {
    method: 'POST',
    body: JSON.stringify({ token, clientSessionId, requestId, action, positionSeconds, durationSeconds: 40 }),
  });
}

function tokenPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

test('happy path keeps the approved event model from Telegram Start through CRM application', async (t) => {
  const server = await makeTestServer();
  t.after(() => server.app.close());

  const started = await start(server, { telegramUserId: 123456789, updateId: 1 });
  assert.equal(started.response.status, 200);
  assert.equal(started.body.ok, true);
  assert.equal(started.body.source.source, 'google');
  assert.equal(started.body.source.articleSlug, 'kak-perezhit-izmenu-zheny');
  assert.equal(started.body.notice.version, localFixture.entryNotice.version);
  assert.equal(started.body.notice.presented, true);
  assert.equal(started.body.bonus.contentRef, 'https://t.me/georgy_sokolovsky/44');
  assert.equal(started.body.bonusDelivery.status, 'sent');
  assert.equal(started.body.telegramUrl, 'https://t.me/sokolovskyi_men_bot?start=article_wife_cheating');
  assert.doesNotMatch(JSON.stringify(started.body), /georgy_sokolovsky\/16/);
  assert.doesNotMatch(JSON.stringify(started.body), /123456789/);
  assert.equal(tokenPayload(started.body.webinar.token).purpose, 'webinar');
  assert.equal(tokenPayload(started.body.webinar.token).funnel_id, 'men_webinar_v1');
  assert.equal(tokenPayload(started.body.webinar.token).user_ref, started.body.userId);

  const webinarToken = started.body.webinar.token;
  const session = await request(server, '/v1/webinar/session', { method: 'POST', body: JSON.stringify({ token: webinarToken }) });
  assert.equal(session.response.status, 200);
  assert.equal(session.body.purpose, 'webinar');
  assert.equal(session.body.webinar.videoProvider, 'native-html5');
  assert.equal(session.body.webinar.videoId, 'lab-men-funnel-video-fixture');
  const page = await fetch(`${server.baseUrl}/webinar/lab-men-funnel-video-fixture?t=${encodeURIComponent(webinarToken)}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-webinar-root/);
  const playerSession = randomUUID();
  await telemetry(server, webinarToken, playerSession, 'play', 0);
  for (const position of [10, 20, 30]) {
    server.clock.value = new Date(server.clock.value.getTime() + 10_000);
    const result = await telemetry(server, webinarToken, playerSession, 'heartbeat', position);
    assert.equal(result.response.status, 201);
  }
  const cta = await event(server, webinarToken, 'cta_clicked', randomUUID());
  assert.equal(cta.response.status, 201);

  const duplicateRequestId = randomUUID();
  server.clock.value = new Date(server.clock.value.getTime() + 1_000);
  const firstPause = await telemetry(server, webinarToken, playerSession, 'pause', 31, duplicateRequestId);
  const duplicate = await telemetry(server, webinarToken, playerSession, 'pause', 31, duplicateRequestId);
  assert.equal(firstPause.response.status, 201);
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.duplicate, true);

  const applicationAccess = await request(server, '/v1/applications/token', {
    method: 'POST',
    body: JSON.stringify({ token: webinarToken }),
  });
  assert.equal(applicationAccess.response.status, 201);
  assert.equal(applicationAccess.body.purpose, 'application');
  assert.equal(tokenPayload(applicationAccess.body.token).purpose, 'application');
  assert.equal(tokenPayload(applicationAccess.body.token).user_ref, started.body.userId);
  assert.notEqual(applicationAccess.body.token, webinarToken);

  const appToken = applicationAccess.body.token;
  const appEvent = await event(server, appToken, 'application_started', randomUUID());
  assert.equal(appEvent.response.status, 201);

  const application = await request(server, '/v1/applications', {
    method: 'POST',
    body: JSON.stringify({
      token: appToken,
      idempotencyKey: 'application-1',
      answers: {
        name: 'Тестовый пользователь',
        situation: 'Техническая проверка пути',
        phone: '+000000000',
        email: 'must-not-be-stored@example.com',
      },
      consent: { accepted: true, policyVersion: 'fixture-1', source: 'local-test' },
    }),
  });
  assert.equal(application.response.status, 201);
  assert.equal(application.body.status, 'submitted');

  const lead = await request(server, `/v1/admin/leads/${started.body.userId}`, { headers: { 'x-admin-local-key': adminKey } });
  assert.equal(lead.response.status, 200);
  assert.equal(lead.body.lead.leadStatus, 'application_submitted');
  assert.deepEqual(lead.body.lead.events.map((item) => item.eventType), [
    'telegram_start',
    'funnel_entry_notice_presented',
    'bonus_delivery_attempted',
    'bonus_sent',
    'webinar_invite_delivery_attempted',
    'webinar_invite_sent',
    'webinar_page_view',
    'webinar_started',
    'watched_25',
    'watched_50',
    'watched_75',
    'cta_clicked',
    'application_started',
    'application_submitted',
  ]);
  assert.equal(lead.body.lead.telegram.telegramUserId, '123456789');
  assert.equal(lead.body.lead.attribution.first_touch.source, 'google');
  assert.equal(lead.body.lead.attribution.first_touch.articleSlug, 'kak-perezhit-izmenu-zheny');
  assert.equal(lead.body.lead.attribution.funnel_entry_touch.source, 'google');
  assert.equal(lead.body.lead.attribution.funnel_id, 'men_webinar_v1');
  assert.equal(lead.body.lead.bonus.status, 'sent');
  assert.equal(lead.body.lead.webinar.maxProgress, 75);
  assert.deepEqual(lead.body.lead.application.answers, {
    name: 'Тестовый пользователь',
    situation: 'Техническая проверка пути',
  });

  const dashboard = await request(server, '/v1/admin/dashboard', { headers: { 'x-admin-local-key': adminKey } });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.dashboard.telegramStarts, 1);
  assert.equal(dashboard.body.dashboard.bonusDeliveryAttempts, 1);
  assert.equal(dashboard.body.dashboard.bonusSent, 1);
  assert.equal(dashboard.body.dashboard.watched50, 1);
  assert.equal(dashboard.body.dashboard.applications, 1);
});

test('bonus failure records attempted and failed without claiming sent', async (t) => {
  const server = await makeTestServer({
    transport: createDevTelegramTransport({ sendBonus: async () => ({ ok: false, errorCode: 'mock_failure' }) }),
  });
  t.after(() => server.app.close());

  const started = await start(server, { telegramUserId: 222, updateId: 2 });
  assert.equal(started.response.status, 200);
  assert.equal(started.body.bonusDelivery.status, 'failed');

  const lead = await request(server, `/v1/admin/leads/${started.body.userId}`, { headers: { 'x-admin-local-key': adminKey } });
  assert.deepEqual(lead.body.lead.events.map((item) => item.eventType), [
    'telegram_start',
    'funnel_entry_notice_presented',
    'bonus_delivery_attempted',
    'bonus_delivery_failed',
  ]);
  assert.equal(lead.body.lead.bonus.status, 'failed');
  assert.equal(started.body.webinar, null);
  assert.equal(started.body.webinarInviteDelivery.status, 'not_started');
  assert.deepEqual((await server.store.listDeliveryOperations()).map((item) => [item.messageType, item.status]), [
    ['entry_notice', 'delivered'],
    ['bonus', 'dead_letter'],
    ['webinar_invite', 'pending'],
  ]);
});

test('entry notice failure stops the remaining message sequence', async (t) => {
  const sentRoles = [];
  const server = await makeTestServer({
    transport: createDevTelegramTransport({
      sendMessage: async ({ message }) => {
        sentRoles.push(message.role);
        return { ok: false, errorCode: 'notice_failure' };
      },
    }),
  });
  t.after(() => server.app.close());

  const started = await start(server, { telegramUserId: 223, updateId: 22 });
  assert.equal(started.body.notice.status, 'failed');
  assert.equal(started.body.bonusDelivery.status, 'not_started');
  assert.equal(started.body.webinarInviteDelivery.status, 'not_started');
  assert.deepEqual(sentRoles, ['entry_notice']);
  assert.deepEqual(server.store.events.map((item) => item.eventType), ['telegram_start']);
  assert.equal(server.store.getTelegramUpdate('men_webinar_v1', 22).status, 'failed');
  assert.equal(server.store.getTelegramUpdate('men_webinar_v1', 22).errorStage, 'entry_notice');
  assert.deepEqual((await server.store.listDeliveryOperations()).map((item) => item.status), ['dead_letter', 'pending', 'pending']);
});

test('webinar invite failure is recorded without claiming invite sent', async (t) => {
  const server = await makeTestServer({
    transport: createDevTelegramTransport({
      sendMessage: async ({ message }) => message.role === 'webinar_invite'
        ? { ok: false, errorCode: 'invite_failure' }
        : { ok: true, messageId: `dev-${message.role}` },
    }),
  });
  t.after(() => server.app.close());

  const started = await start(server, { telegramUserId: 224, updateId: 23 });
  assert.equal(started.body.bonusDelivery.status, 'sent');
  assert.equal(started.body.webinarInviteDelivery.status, 'failed');
  assert.deepEqual(server.store.events.map((item) => item.eventType).slice(-2), [
    'webinar_invite_delivery_attempted',
    'webinar_invite_delivery_failed',
  ]);
  assert.equal(server.store.events.some((item) => item.eventType === 'webinar_invite_sent'), false);
  assert.equal(server.store.getTelegramUpdate('men_webinar_v1', 23).errorStage, 'webinar_invite');
});

test('first touch is immutable and direct entry has nullable article slug', async (t) => {
  const server = await makeTestServer();
  t.after(() => server.app.close());

  assert.equal(server.store.users.size, 0);
  const articleEntry = await start(server, { telegramUserId: 333, updateId: 3 });
  assert.equal(articleEntry.body.source.source, 'google');
  assert.equal(articleEntry.body.source.articleSlug, 'kak-perezhit-izmenu-zheny');

  const repeatThroughDirect = await start(server, { telegramUserId: 333, startParameter: 'instagram_men_webinar', updateId: 4 });
  assert.equal(repeatThroughDirect.body.duplicate, false);
  const articleLead = await request(server, `/v1/admin/leads/${articleEntry.body.userId}`, { headers: { 'x-admin-local-key': adminKey } });
  assert.equal(articleLead.body.lead.attribution.first_touch.source, 'google');
  assert.equal(articleLead.body.lead.attribution.first_touch.articleSlug, 'kak-perezhit-izmenu-zheny');
  assert.equal(articleLead.body.lead.attribution.funnel_entry_touch.source, 'google');
  assert.equal(articleLead.body.lead.events.filter((item) => item.eventType === 'telegram_start').length, 2);

  const directEntry = await start(server, { telegramUserId: 444, startParameter: 'instagram_men_webinar', updateId: 5 });
  const directLead = await request(server, `/v1/admin/leads/${directEntry.body.userId}`, { headers: { 'x-admin-local-key': adminKey } });
  assert.equal(directLead.body.lead.attribution.first_touch.source, 'instagram');
  assert.equal(directLead.body.lead.attribution.first_touch.articleSlug, null);
  assert.equal(directLead.body.lead.attribution.funnel_entry_touch.articleSlug, null);
  assert.equal(directLead.body.lead.attribution.article_slug, null);
});

test('webinar and application tokens are purpose-bound', async (t) => {
  const server = await makeTestServer();
  t.after(() => server.app.close());
  const started = await start(server, { telegramUserId: 555, updateId: 6 });
  const webinarToken = started.body.webinar.token;

  const noCta = await request(server, '/v1/applications/token', { method: 'POST', body: JSON.stringify({ token: webinarToken }) });
  assert.equal(noCta.response.status, 409);

  await event(server, webinarToken, 'cta_clicked', randomUUID());
  const access = await request(server, '/v1/applications/token', { method: 'POST', body: JSON.stringify({ token: webinarToken }) });
  assert.equal(access.response.status, 201);
  const applicationToken = access.body.token;

  const webinarWithApplicationToken = await request(server, '/v1/webinar/session', { method: 'POST', body: JSON.stringify({ token: applicationToken }) });
  assert.equal(webinarWithApplicationToken.response.status, 401);
  const applicationWithWebinarToken = await request(server, '/v1/applications', {
    method: 'POST',
    body: JSON.stringify({ token: webinarToken, answers: { name: 'X', situation: 'Y' }, consent: { accepted: true, policyVersion: '1', source: 'test' } }),
  });
  assert.equal(applicationWithWebinarToken.response.status, 401);
});

test('stop disables promotional messaging and delete creates a pending request', async (t) => {
  const server = await makeTestServer();
  t.after(() => server.app.close());
  const started = await start(server, { telegramUserId: 666, updateId: 7 });

  const stopped = await server.flow.stopTelegramFlow({ telegramUserId: 666 });
  assert.equal(stopped.event.eventType, 'telegram_stop');
  assert.equal(await server.flow.canSendPromotional(started.body.userId), false);
  const repeatedStop = await server.flow.stopTelegramFlow({ telegramUserId: 666 });
  assert.equal(repeatedStop.duplicate, true);

  const deletion = await server.flow.requestDataDeletion({ telegramUserId: 666 });
  assert.equal(deletion.event.eventType, 'data_deletion_requested');
  assert.equal(deletion.request.status, 'requested');

  const lead = await request(server, `/v1/admin/leads/${started.body.userId}`, { headers: { 'x-admin-local-key': adminKey } });
  assert.equal(lead.body.lead.messaging.promotional, false);
  assert.equal(lead.body.lead.deletionRequest.status, 'requested');
  assert.deepEqual(lead.body.lead.events.map((item) => item.eventType).slice(-2), [
    'telegram_stop',
    'data_deletion_requested',
  ]);
});

test('invalid application does not create application_submitted and warming rules stay config-driven', async (t) => {
  const server = await makeTestServer();
  t.after(() => server.app.close());
  const started = await start(server, { telegramUserId: 777, updateId: 8 });
  const webinarToken = started.body.webinar.token;
  await event(server, webinarToken, 'cta_clicked', randomUUID());
  const access = await request(server, '/v1/applications/token', { method: 'POST', body: JSON.stringify({ token: webinarToken }) });

  const invalid = await request(server, '/v1/applications', {
    method: 'POST',
    body: JSON.stringify({
      token: access.body.token,
      answers: { name: '', situation: '' },
      consent: { accepted: true, policyVersion: 'fixture-1', source: 'local-test' },
    }),
  });
  assert.equal(invalid.response.status, 400);

  const lead = await request(server, `/v1/admin/leads/${started.body.userId}`, { headers: { 'x-admin-local-key': adminKey } });
  assert.equal(lead.body.lead.application, null);
  assert.equal(lead.body.lead.events.some((item) => item.eventType === 'application_submitted'), false);
  assert.deepEqual((await server.flow.warmingConfig()).map((rule) => rule.delaySeconds).sort((a, b) => a - b), [900, 7200, 10800, 21600]);
  assert.equal(FUNNEL_EVENTS.includes('bonus_received'), false);
});

test('Telegram webhook validates its secret and remains idempotent', async (t) => {
  const server = await makeTestServer();
  t.after(() => server.app.close());
  const update = { update_id: 42, message: { from: { id: 888, first_name: 'Webhook' }, text: '/start article_wife_cheating' } };
  const denied = await request(server, '/v1/webhooks/telegram', { method: 'POST', body: JSON.stringify(update) });
  assert.equal(denied.response.status, 401);
  const accepted = await request(server, '/v1/webhooks/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    body: JSON.stringify(update),
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.duplicate, false);
  const repeated = await request(server, '/v1/webhooks/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    body: JSON.stringify(update),
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.duplicate, true);
});
