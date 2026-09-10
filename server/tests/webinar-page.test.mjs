import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createDevTelegramTransport } from '../src/telegram/transport.mjs';
import { createApp } from '../src/http/app.mjs';
import { signFunnelToken, verifyFunnelToken } from '../src/security/signed-tokens.mjs';

const signingSecret = 'webinar-page-test-secret';

async function makeServer() {
  const clock = { value: new Date('2026-09-10T10:00:00.000Z') };
  const store = new MemoryStore({ now: () => clock.value });
  store.seed(localFixture);
  const flow = createMenWebinarFlow({
    store, signingSecret, botUsername: localFixture.telegramBotUsername,
    entryNotice: localFixture.entryNotice, webinarBaseUrl: 'http://127.0.0.1/webinar',
    transport: createDevTelegramTransport(), now: () => clock.value,
    schedulerOptions: { now: () => clock.value, random: () => 0 },
    recoveryOptions: { now: () => clock.value },
  });
  const app = createApp({ flow, mode: 'local', webhookSecret: 'webhook', adminKey: 'admin' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  return { app, flow, store, clock, baseUrl: `http://127.0.0.1:${app.address().port}` };
}

async function makeServerWithPlaybackProvider(playbackSourceProvider) {
  const server = await makeServer();
  await new Promise((resolve) => server.app.close(resolve));
  const flow = createMenWebinarFlow({
    store: server.store, signingSecret, botUsername: localFixture.telegramBotUsername,
    entryNotice: localFixture.entryNotice, webinarBaseUrl: 'http://127.0.0.1/webinar',
    transport: createDevTelegramTransport(), now: () => server.clock.value,
    schedulerOptions: { now: () => server.clock.value, random: () => 0 },
    recoveryOptions: { now: () => server.clock.value }, playbackSourceProvider,
  });
  const app = createApp({ flow, mode: 'local', webhookSecret: 'webhook', adminKey: 'admin' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  return { ...server, app, flow, baseUrl: `http://127.0.0.1:${app.address().port}` };
}

async function start(server, telegramUserId) {
  return server.flow.handleTelegramStart({ telegramUserId, startParameter: 'article_wife_cheating', updateId: telegramUserId, timestamp: server.clock.value.toISOString() });
}

async function post(server, path, body) {
  const response = await fetch(`${server.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

async function telemetry(server, token, session, action, position, requestId = randomUUID(), extra = {}) {
  return post(server, '/v1/webinar/telemetry', {
    token, clientSessionId: session, requestId, action,
    positionSeconds: position, durationSeconds: 40, ...extra,
  });
}

test('signed webinar page validates access without making the token one-time', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_001);
  const path = `/webinar/lab-men-funnel-video-fixture?t=${encodeURIComponent(started.webinar.token)}`;
  let mediaPath;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${server.baseUrl}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const html = await response.text();
    assert.match(html, /data-webinar-root/);
    const source = html.match(/data-playback-source="([^"]+)"/)?.[1];
    assert.ok(source);
    mediaPath = source;
  }
  assert.equal((await server.store.listUserEvents(started.userId)).filter((event) => event.eventType === 'webinar_page_view').length, 1);
  const range = await fetch(`${server.baseUrl}${mediaPath}`, { headers: { range: 'bytes=0-99' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-type'), 'video/mp4');
  assert.equal(range.headers.get('accept-ranges'), 'bytes');
  assert.equal(range.headers.get('content-range'), 'bytes 0-99/28891');
  assert.equal(range.headers.get('content-length'), '100');
  assert.equal(range.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(range.headers.get('access-control-allow-origin'), null);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
});

test('Mux playback source is issued only after MEN webinar authorization', async (t) => {
  let issueCount = 0;
  const playbackSourceProvider = {
    createPlaybackSource() {
      issueCount += 1;
      return { videoProvider: 'mux-hls', videoUrl: 'https://stream.mux.com/TestPlayback123.m3u8?token=temporary-jwt' };
    },
  };
  const server = await makeServerWithPlaybackProvider(playbackSourceProvider);
  t.after(() => server.app.close());
  const started = await start(server, 51_009);
  const application = signFunnelToken({ purpose: 'application', userRef: started.userId, funnelId: started.funnelId, secret: signingSecret, now: () => server.clock.value.getTime() });
  const expired = signFunnelToken({ purpose: 'webinar', userRef: started.userId, funnelId: started.funnelId, ttlSeconds: 60, secret: signingSecret, now: () => server.clock.value.getTime() - 120_000 });
  for (const token of [application, expired]) {
    const response = await fetch(`${server.baseUrl}/webinar/${localFixture.webinar.videoId}?t=${encodeURIComponent(token)}`);
    assert.equal(response.status, 401);
  }
  assert.equal(issueCount, 0);
  const response = await fetch(`${server.baseUrl}/webinar/${localFixture.webinar.videoId}?t=${encodeURIComponent(started.webinar.token)}`);
  assert.equal(response.status, 200);
  assert.equal(issueCount, 1);
  assert.match(response.headers.get('content-security-policy'), /https:\/\/stream\.mux\.com/);
  const html = await response.text();
  assert.match(html, /data-video-provider="mux-hls"/);
  assert.match(html, /\/v1\/webinar\/hls\.js/);
  assert.equal(html.includes('private-key'), false);
  const hls = await fetch(`${server.baseUrl}/v1/webinar/hls.js`);
  assert.equal(hls.status, 200);
  assert.match(hls.headers.get('content-type'), /text\/javascript/);
});

test('media source requires a short-lived video-bound media token and handles ranges', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_008);
  const pageResponse = await fetch(`${server.baseUrl}/webinar/lab-men-funnel-video-fixture?t=${encodeURIComponent(started.webinar.token)}`);
  const html = await pageResponse.text();
  const mediaPath = html.match(/data-playback-source="([^"]+)"/)?.[1];
  const mediaUrl = new URL(mediaPath, server.baseUrl);
  const mediaToken = mediaUrl.searchParams.get('mt');
  assert.ok(mediaToken);
  assert.notEqual(mediaToken, started.webinar.token);
  const verified = verifyFunnelToken(mediaToken, { purpose: 'media', secret: signingSecret, now: () => server.clock.value.getTime() });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.user_ref, started.userId);
  assert.equal(verified.payload.funnel_id, started.funnelId);
  assert.equal(verified.payload.video_id, localFixture.webinar.videoId);
  assert.ok(verified.payload.expires_at - verified.payload.issued_at >= 15 * 60);

  const full = await fetch(mediaUrl);
  assert.equal(full.status, 200);
  assert.equal(Number(full.headers.get('content-length')), 28_891);
  await full.body.cancel();
  const suffix = await fetch(mediaUrl, { headers: { range: 'bytes=-32' } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get('content-range'), 'bytes 28859-28890/28891');
  assert.equal((await suffix.arrayBuffer()).byteLength, 32);
  const openEnded = await fetch(mediaUrl, { headers: { range: 'bytes=28880-' } });
  assert.equal(openEnded.status, 206);
  assert.equal(openEnded.headers.get('content-length'), '11');
  const head = await fetch(mediaUrl, { method: 'HEAD', headers: { range: 'bytes=0-9' } });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-length'), '10');
  const invalidRange = await fetch(mediaUrl, { headers: { range: 'bytes=99999-' } });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get('content-range'), 'bytes */28891');
});

test('media endpoint fails closed for missing, wrong-purpose, wrong-video, wrong-funnel and expired tokens', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_009);
  const basePath = '/v1/webinar/media/lab-men-funnel-video-fixture';
  const application = signFunnelToken({ purpose: 'application', userRef: started.userId, funnelId: started.funnelId, secret: signingSecret, now: () => server.clock.value.getTime() });
  const otherVideo = signFunnelToken({ purpose: 'media', userRef: started.userId, funnelId: started.funnelId, videoId: 'other-video', secret: signingSecret, now: () => server.clock.value.getTime() });
  const otherFunnel = signFunnelToken({ purpose: 'media', userRef: started.userId, funnelId: 'other-funnel', videoId: localFixture.webinar.videoId, secret: signingSecret, now: () => server.clock.value.getTime() });
  const expired = signFunnelToken({ purpose: 'media', userRef: started.userId, funnelId: started.funnelId, videoId: localFixture.webinar.videoId, ttlSeconds: 60, secret: signingSecret, now: () => server.clock.value.getTime() - 120_000 });
  for (const token of [null, started.webinar.token, application, otherVideo, otherFunnel, expired]) {
    const suffix = token == null ? '' : `?mt=${encodeURIComponent(token)}`;
    const response = await fetch(`${server.baseUrl}${basePath}${suffix}`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await response.json()).ok, false);
  }
});

test('expired, invalid and application tokens cannot open webinar or create events', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_002);
  const baseline = (await server.store.listUserEvents(started.userId)).length;
  const expired = signFunnelToken({ purpose: 'webinar', userRef: started.userId, funnelId: started.funnelId, ttlSeconds: 60, secret: signingSecret, now: () => server.clock.value.getTime() - 120_000 });
  const application = signFunnelToken({ purpose: 'application', userRef: started.userId, funnelId: started.funnelId, secret: signingSecret, now: () => server.clock.value.getTime() });
  const wrongFunnel = signFunnelToken({ purpose: 'webinar', userRef: started.userId, funnelId: 'forged-funnel', secret: signingSecret, now: () => server.clock.value.getTime() });
  for (const token of [expired, application, wrongFunnel, 'invalid.token']) {
    const response = await fetch(`${server.baseUrl}/webinar/lab-men-funnel-video-fixture?t=${encodeURIComponent(token)}`);
    assert.equal(response.status, 401);
    assert.match(await response.text(), /Ссылка недействительна/);
  }
  assert.equal((await server.store.listUserEvents(started.userId)).length, baseline);
});

test('server derives progress from watched ranges and rejects seek inflation', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_003);
  const session = randomUUID();
  await telemetry(server, started.webinar.token, session, 'play', 0);
  server.clock.value = new Date(server.clock.value.getTime() + 5_000);
  await telemetry(server, started.webinar.token, session, 'heartbeat', 5);
  await telemetry(server, started.webinar.token, session, 'seek', 35);
  await telemetry(server, started.webinar.token, session, 'play', 35);
  server.clock.value = new Date(server.clock.value.getTime() + 2_000);
  await telemetry(server, started.webinar.token, session, 'pause', 37);
  server.clock.value = new Date(server.clock.value.getTime() + 30_000);
  const paused = await telemetry(server, started.webinar.token, session, 'heartbeat', 39);
  assert.equal(paused.body.progressPercent, 17.5);
  await telemetry(server, started.webinar.token, session, 'play', 37);
  server.clock.value = new Date(server.clock.value.getTime() + 3_000);
  const completedPosition = await telemetry(server, started.webinar.token, session, 'ended', 40);
  assert.equal(completedPosition.body.progressPercent, 25);
  assert.deepEqual(completedPosition.body.milestones, [25]);
  const types = (await server.store.listUserEvents(started.userId)).map((event) => event.eventType);
  assert.equal(types.filter((type) => type === 'watched_25').length, 1);
  assert.equal(types.includes('watched_75'), false);
  assert.equal(types.includes('watched_100'), false);
});

test('legitimate playback emits every milestone including watched 100 and completion', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_007);
  const session = randomUUID();
  await telemetry(server, started.webinar.token, session, 'play', 0);
  for (const [position, seconds, action] of [[10, 10, 'heartbeat'], [20, 10, 'heartbeat'], [30, 10, 'heartbeat'], [36, 6, 'heartbeat'], [40, 4, 'ended']]) {
    server.clock.value = new Date(server.clock.value.getTime() + seconds * 1000);
    await telemetry(server, started.webinar.token, session, action, position);
  }
  const types = (await server.store.listUserEvents(started.userId)).map((event) => event.eventType);
  for (const type of ['webinar_started', 'watched_25', 'watched_50', 'watched_75', 'watched_90', 'watched_100', 'webinar_completed']) {
    assert.equal(types.filter((item) => item === type).length, 1);
  }
  assert.equal((await server.flow.leadDetails(started.userId)).webinar.maxProgress, 100);
});

test('duplicate requests, refresh and concurrent tabs create one milestone and no duplicate schedule', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_004);
  const firstTab = randomUUID();
  const secondTab = randomUUID();
  await telemetry(server, started.webinar.token, firstTab, 'play', 0);
  await telemetry(server, started.webinar.token, secondTab, 'play', 0);
  server.clock.value = new Date(server.clock.value.getTime() + 10_000);
  const requestId = randomUUID();
  const [first, second] = await Promise.all([
    telemetry(server, started.webinar.token, firstTab, 'heartbeat', 10, requestId),
    telemetry(server, started.webinar.token, firstTab, 'heartbeat', 10, requestId),
  ]);
  assert.deepEqual([first.response.status, second.response.status].sort(), [200, 201]);
  await telemetry(server, started.webinar.token, secondTab, 'heartbeat', 10);
  const refreshTab = randomUUID();
  await telemetry(server, started.webinar.token, refreshTab, 'play', 0);
  server.clock.value = new Date(server.clock.value.getTime() + 10_000);
  await telemetry(server, started.webinar.token, refreshTab, 'heartbeat', 10);
  const events = await server.store.listUserEvents(started.userId);
  assert.equal(events.filter((event) => event.eventType === 'webinar_started').length, 1);
  assert.equal(events.filter((event) => event.eventType === 'watched_25').length, 1);
  assert.equal((await server.store.listDeliveryOperations({ userId: started.userId })).filter((operation) => operation.descriptor?.ruleName === 'continue_watching_6h').length, 1);
});

test('restricted endpoints reject arbitrary events and ignore forged identity fields', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_005);
  const generic = await post(server, '/v1/events', { token: started.webinar.token, eventType: 'sold' });
  assert.equal(generic.response.status, 404);
  const invalid = await telemetry(server, started.webinar.token, randomUUID(), 'application_submitted', 0);
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'invalid_event');
  const session = randomUUID();
  const forged = await telemetry(server, started.webinar.token, session, 'play', 0, randomUUID(), { userId: randomUUID(), funnelId: 'forged' });
  assert.equal(forged.response.status, 201);
  const startedEvent = (await server.store.listUserEvents(started.userId)).find((event) => event.eventType === 'webinar_started');
  assert.equal(startedEvent.userId, started.userId);
  assert.equal(startedEvent.funnelId, started.funnelId);
});

test('watched 75 schedules follow-up once; CTA and application use specialized endpoints', async (t) => {
  const server = await makeServer();
  t.after(() => server.app.close());
  const started = await start(server, 51_006);
  const session = randomUUID();
  await telemetry(server, started.webinar.token, session, 'play', 0);
  for (const position of [10, 20, 30]) {
    server.clock.value = new Date(server.clock.value.getTime() + 10_000);
    await telemetry(server, started.webinar.token, session, 'heartbeat', position);
  }
  let followUps = (await server.store.listDeliveryOperations({ userId: started.userId })).filter((operation) => operation.descriptor?.ruleName === 'application_follow_up_2h');
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].status, 'scheduled');
  const cta = await post(server, '/v1/webinar/cta', { token: started.webinar.token, requestId: randomUUID() });
  assert.equal(cta.response.status, 201);
  followUps = (await server.store.listDeliveryOperations({ userId: started.userId })).filter((operation) => operation.descriptor?.ruleName === 'application_follow_up_2h');
  assert.equal(followUps[0].status, 'cancelled');
  const token = await post(server, '/v1/applications/token', { token: started.webinar.token });
  const applicationStarted = await post(server, '/v1/applications/events', { token: token.body.token, requestId: randomUUID() });
  assert.equal(applicationStarted.response.status, 201);
  const application = await post(server, '/v1/applications', {
    token: token.body.token, idempotencyKey: 'webinar-page-application',
    answers: { name: 'Тест', situation: 'Проверка', email: 'ignored@example.com' },
    consent: { accepted: true, policyVersion: 'fixture-1', source: 'webinar-page-test' },
  });
  assert.equal(application.response.status, 201);
  const duplicateApplication = await post(server, '/v1/applications', {
    token: token.body.token, idempotencyKey: 'different-browser-request',
    answers: { name: 'Другое', situation: 'Не должно перезаписать первую заявку' },
    consent: { accepted: true, policyVersion: 'fixture-1', source: 'second-tab' },
  });
  assert.equal(duplicateApplication.response.status, 200);
  assert.equal(duplicateApplication.body.duplicate, true);
  assert.deepEqual((await server.store.getApplicationForUser(started.userId)).answers, { name: 'Тест', situation: 'Проверка' });
});
