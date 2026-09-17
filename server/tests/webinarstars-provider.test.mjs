import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { buildWebinarStarsUrl, createCorrelationHmac, createCorrelationToken, parseCorrelationToken } from '../src/webinarstars/correlation.mjs';
import { createWebinarStarsClient, WebinarStarsApiError } from '../src/webinarstars/client.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { createWebinarStarsLifecycle } from '../src/webinarstars/lifecycle.mjs';
import { classifyVisitor, normalizeProviderTimestamp, normalizeReport, normalizeReports, selectReportForSession } from '../src/webinarstars/normalize.mjs';
import { createWebinarStarsSyncScheduler } from '../src/webinarstars/sync-scheduler.mjs';

const secret = 'offline-webinarstars-correlation-secret';
const start = '2026-09-15T20:00:00.000Z';
const end = '2026-09-15T21:00:00.000Z';
const config = Object.freeze({
  correlationSecret: secret, webinarId: '32439', registrationUrl: 'https://example.invalid/register',
  timeZone: 'Europe/Kiev',
  scheduledStart: start, scheduledEnd: end, pollOffsetsMinutes: [0, 1, 3, 5, 10, 15],
  targetCtaShowNumbers: ['1', '2'], offerBoundarySeconds: 3300,
});

function makeStore(now = () => new Date(end)) {
  const store = new MemoryStore({ now });
  store.seed(localFixture);
  return store;
}

test('stable pseudonymous token and URL contract do not expose a funnel UUID', () => {
  const entryA = '11111111-1111-4111-8111-111111111111';
  const entryB = '22222222-2222-4222-8222-222222222222';
  const first = createCorrelationToken(entryA, secret);
  assert.equal(first, createCorrelationToken(entryA, secret));
  assert.notEqual(first, createCorrelationToken(entryB, secret));
  assert.match(first, /^[a-z0-9]{16}$/);
  const url = new URL(buildWebinarStarsUrl(config.registrationUrl, first));
  assert.equal(url.searchParams.get('utm_source'), 'telegram');
  assert.equal(url.searchParams.get('utm_medium'), 'bot');
  assert.equal(url.searchParams.get('utm_campaign'), 'men_webinar_v1');
  assert.equal(url.searchParams.get('utm_content'), first);
  assert.equal(url.searchParams.has('men_ref'), false);
  assert.equal(url.toString().includes(entryA), false);
  assert.equal(parseCorrelationToken(`utm_source=telegram&utm_content=${first}`), first);
  assert.equal(parseCorrelationToken('utm_content=unknown'), null);
});

test('experience provider stores only lookup HMAC and regenerates the same URL', async () => {
  const store = makeStore();
  const user = store.createUser({ funnelId: localFixture.funnel.id, funnelEntryTouch: { source: 'test' } });
  const provider = createWebinarStarsExperienceProvider({ store, config });
  const first = await provider.createExperienceUrl({ user });
  const second = await provider.createExperienceUrl({ user });
  assert.equal(first.url, second.url);
  const token = new URL(first.url).searchParams.get('utm_content');
  const correlation = store.findProviderCorrelation({ provider: 'webinarstars', correlationHmac: createCorrelationHmac(token, secret) });
  assert.equal(correlation.userId, user.id);
  assert.equal(JSON.stringify([...store.providerCorrelations.values()]).includes(token), false);
  assert.equal(store.providerSyncSessions.size, 1);
});

test('API client normalizes transport failures without exposing its URL', async () => {
  const requests = [];
  const client = createWebinarStarsClient({ baseUrl: 'https://provider.invalid/', apiToken: 'private-token', fetchImpl: async (url) => {
    requests.push(url);
    return { ok: true, status: 200, json: async () => ({ reports: [] }) };
  }});
  assert.deepEqual(await client.getReports(), { reports: [] });
  assert.equal(requests[0].searchParams.get('token'), 'private-token');
  const failing = createWebinarStarsClient({ baseUrl: 'https://provider.invalid', apiToken: 'private-token', fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(failing.getReports(), (error) => error instanceof WebinarStarsApiError && error.category === 'retryable' && !error.message.includes('private-token'));
});

test('report normalization, strict session selection and provider semantics are loss-limited', () => {
  const reports = normalizeReports({ reports: [{ report_id: 397771, webinar_id: 32439, date_start: start, date_end: end }, { report_id: 1, webinar_id: 31195, date_start: start, date_end: end }] });
  const selected = selectReportForSession(reports, { webinarId: '32439', scheduledStart: start, scheduledEnd: end });
  assert.equal(selected.reportId, '397771');
  assert.equal(selectReportForSession(reports, { webinarId: '32439', scheduledStart: '2026-09-16T20:00:00Z', scheduledEnd: '2026-09-16T21:00:00Z' }), null);
  assert.throws(() => selectReportForSession([...reports, { ...reports[0], reportId: '397772' }], { webinarId: '32439', scheduledStart: start, scheduledEnd: end }), /ambiguous/);

  const report = normalizeReport({ report_id: 397771, webinar_id: '32439', visitors: [{
    visitor_id: 91, utm: 'utm_content=aaaaaaaaaaaaaaaa', date_start: '2026-09-15T20:05:00Z', date_end: '2026-09-15T20:35:00Z',
    buttons_info: [{ type: 'button', show_number: 2, status: 'clicked' }, { type: 'button', show_number: 3, status: 'unexpected' }],
    comments: [{ text: 'must never persist' }], name: 'must never persist', email: 'private@example.com',
  }] });
  assert.equal(report.visitors[0].presenceSeconds, 1800);
  assert.deepEqual(report.visitors[0].buttons.map((button) => button.status), ['clicked', 'unseen']);
  assert.equal(report.visitors[0].commentCount, 1);
  assert.equal(JSON.stringify(report).includes('must never persist'), false);
  assert.equal(JSON.stringify(report).includes('private@example.com'), false);
  const signals = classifyVisitor(report.visitors[0], { scheduledStart: start, scheduledEnd: end }, { ...config, targetCtaShowNumbers: ['2'] });
  assert.equal(signals.presenceRatio, 0.5);
  assert.equal('presenceClass' in signals, false);
  assert.equal(signals.targetCtaClicked, true);
  assert.equal('watchedVideoSeconds' in signals, false);
});

test('WebinarStars local datetimes use the configured IANA zone across summer and winter', () => {
  const reports = normalizeReports({ reports: [{
    report_id: 31195, webinar_id: 31195, timezone: '3.0',
    date_start: '2026-09-17 19:00:00', date_end: '2026-09-17 20:31:00',
  }] }, { timeZone: 'Europe/Kiev' });
  assert.equal(reports[0].scheduledStart, '2026-09-17T16:00:00.000Z');
  assert.equal(reports[0].scheduledEnd, '2026-09-17T17:31:00.000Z');
  assert.equal(selectReportForSession(reports, { webinarId: '31195', scheduledStart: '2026-09-17T16:00:00Z', scheduledEnd: '2026-09-17T17:31:00Z' })?.reportId, '31195');
  assert.equal(selectReportForSession(reports, { webinarId: '31195', scheduledStart: '2026-09-17T16:01:00Z', scheduledEnd: '2026-09-17T17:31:00Z' }), null);
  const report = normalizeReport({ report_id: 31195, webinar_id: 31195, timezone: '3.0', visitors: [{
    visitor_id: 1, date_start: '2026-09-17 18:19:40', date_end: '2026-09-17 19:03:57',
  }] }, { timeZone: 'Europe/Kiev' });
  assert.equal(report.visitors[0].presenceStarted, '2026-09-17T15:19:40.000Z');
  assert.equal(report.visitors[0].presenceEnded, '2026-09-17T16:03:57.000Z');
  assert.equal(report.visitors[0].presenceSeconds, 2657);
  const winter = normalizeReports({ reports: [{ report_id: 2, webinar_id: 31195, timezone: '2.0',
    date_start: '2026-01-15 19:00:00', date_end: '2026-01-15 20:31:00' }] }, { timeZone: 'Europe/Kiev' });
  assert.equal(winter[0].scheduledStart, '2026-01-15T17:00:00.000Z');
  assert.equal(winter[0].scheduledEnd, '2026-01-15T18:31:00.000Z');
  assert.equal(normalizeProviderTimestamp('2026-03-29 03:30:00', 'Europe/Kiev'), null);
  assert.equal(normalizeProviderTimestamp('2026-10-25 03:30:00', 'Europe/Kiev'), null);
  assert.equal(normalizeProviderTimestamp('2026-02-30 19:00:00', 'Europe/Kiev'), null);
  assert.equal(normalizeReports({ reports: [{ report_id: 1, webinar_id: 31195, date_start: '2026-09-17 19:00:00', date_end: '2026-09-17 20:31:00' }] })[0].scheduledStart, null);
});

test('persistent sync correlates visitor, is idempotent and never creates internal watch milestones', async () => {
  const clock = { value: new Date(end) };
  const store = makeStore(() => clock.value);
  const user = store.createUser({ funnelId: localFixture.funnel.id, funnelEntryTouch: { source: 'test' } });
  await createWebinarStarsExperienceProvider({ store, config }).createExperienceUrl({ user });
  const token = createCorrelationToken(user.id, secret);
  const client = {
    getReports: async () => ({ reports: [{ report_id: 397771, webinar_id: 32439, date_start: start, date_end: end }] }),
    getReport: async () => ({ report_id: 397771, webinar_id: 32439, date_start: start, date_end: end, visitors: [{ visitor_id: 77, utm: `utm_source=telegram&utm_content=${token}`, date_start: '2026-09-15T20:00:00Z', date_end: '2026-09-15T20:30:00Z', buttons_info: [{ show_number: 1, type: 'button', status: 'seen' }], comments: [] }] }),
  };
  const scheduler = createWebinarStarsSyncScheduler({ store, client, config, now: () => clock.value, workerId: 'worker-a' });
  const first = await scheduler.run();
  assert.equal(first.completed, 1);
  assert.equal(first.matched, 1);
  assert.equal((await scheduler.run()).claimed, 0);
  assert.equal(store.listProviderVisitors().length, 1);
  const events = store.listUserEvents(user.id);
  assert.equal(events.filter((event) => event.eventType === 'webinarstars_attended').length, 1);
  assert.equal(events.some((event) => /^watched_/.test(event.eventType)), false);
  const persisted = JSON.stringify(store.listProviderVisitors());
  assert.equal(persisted.includes(token), false);
  assert.equal(persisted.includes('utm_content'), false);
});

test('summer provider report preserves raw waiting-room presence but segments on session overlap', async () => {
  const summer = { ...config, webinarId: '31195', scheduledStart: '2026-09-17T16:00:00.000Z',
    scheduledEnd: '2026-09-17T17:31:00.000Z' };
  const clock = { value: new Date(summer.scheduledEnd) };
  const store = makeStore(() => clock.value);
  const user = store.createUser({ funnelId: localFixture.funnel.id, funnelEntryTouch: { source: 'test' } });
  await createWebinarStarsExperienceProvider({ store, config: summer }).createExperienceUrl({ user });
  const session = [...store.providerSyncSessions.values()][0];
  assert.equal(session.nextPollAt, summer.scheduledEnd);
  const token = createCorrelationToken(user.id, secret);
  const client = {
    getReports: async () => ({ reports: [{ report_id: 398336, webinar_id: 31195, timezone: '3.0',
      date_start: '2026-09-17 19:00:00', date_end: '2026-09-17 20:31:00' }] }),
    getReport: async () => ({ report_id: 398336, webinar_id: 31195, timezone: '3.0',
      date_start: '2026-09-17 19:00:00', date_end: '2026-09-17 20:31:00', visitors: [{
        visitor_id: 1, utm: `utm_content=${token}`, date_start: '2026-09-17 18:20:00', date_end: '2026-09-17 19:20:00',
        buttons_info: [{ show_number: 1, status: 'unseen' }, { show_number: 2, status: 'unseen' }],
      }] }),
  };
  const scheduler = createWebinarStarsSyncScheduler({ store, client, config: summer,
    lifecycle: createWebinarStarsLifecycle({ store, config: summer }), now: () => clock.value });
  assert.equal((await scheduler.run()).completed, 1);
  const visitor = store.listProviderVisitors()[0];
  assert.equal(visitor.signals.presenceSeconds, 3600);
  assert.equal(visitor.signals.effectivePresenceSeconds, 1200);
  assert.equal(visitor.signals.effectivePresenceRatio, 1200 / 5460);
  const decision = store.listProviderSegmentDecisions()[0];
  assert.equal(decision.segment, 'LEFT_BEFORE_OFFER');
  assert.equal(decision.signals.presenceSeconds, 3600);
  assert.equal(decision.signals.effectivePresenceSeconds, 1200);
  assert.equal(store.listProviderFollowUps().length, 1);
  assert.equal((await scheduler.run()).claimed, 0);
});

test('matched visitor with reversed provider timestamps cannot produce a decision or follow-up', async () => {
  const clock = { value: new Date(end) };
  const store = makeStore(() => clock.value);
  const user = store.createUser({ funnelId: localFixture.funnel.id });
  await createWebinarStarsExperienceProvider({ store, config }).createExperienceUrl({ user });
  const token = createCorrelationToken(user.id, secret);
  const client = {
    getReports: async () => ({ reports: [{ report_id: 7, webinar_id: 32439, date_start: start, date_end: end }] }),
    getReport: async () => ({ report_id: 7, webinar_id: 32439, date_start: start, date_end: end,
      visitors: [{ visitor_id: 1, utm: `utm_content=${token}`, date_start: '2026-09-15T20:20:00Z', date_end: '2026-09-15T20:10:00Z' }] }),
  };
  const result = await createWebinarStarsSyncScheduler({ store, client, config,
    lifecycle: createWebinarStarsLifecycle({ store, config }), now: () => clock.value }).run();
  assert.equal(result.completed, 0);
  assert.equal(result.finalizationPending, 1);
  assert.equal(store.listProviderSegmentDecisions().length, 0);
  assert.equal(store.listProviderFollowUps().length, 0);
});

test('unknown correlation is fail-closed and retries follow +0/+1/+3/+5/+10/+15', async () => {
  const clock = { value: new Date(end) };
  const store = makeStore(() => clock.value);
  const user = store.createUser({ funnelId: localFixture.funnel.id, funnelEntryTouch: { source: 'test' } });
  await createWebinarStarsExperienceProvider({ store, config }).createExperienceUrl({ user });
  const session = [...store.providerSyncSessions.values()][0];
  const emptyClient = { getReports: async () => ({ reports: [] }), getReport: async () => ({}) };
  const scheduler = createWebinarStarsSyncScheduler({ store, client: emptyClient, config, now: () => clock.value, workerId: 'worker-retry' });
  for (const expectedMinute of [1, 3, 5, 10, 15]) {
    await scheduler.run();
    const saved = store.getProviderSyncSession(session.id);
    assert.equal(saved.nextPollAt, new Date(new Date(end).getTime() + expectedMinute * 60_000).toISOString());
    clock.value = new Date(saved.nextPollAt);
  }
  await scheduler.run();
  assert.equal(store.getProviderSyncSession(session.id).status, 'finalization_pending');

  const retryClock = { value: new Date(end) };
  const unmatchedStore = makeStore(() => retryClock.value);
  const unmatchedUser = unmatchedStore.createUser({ funnelId: localFixture.funnel.id, funnelEntryTouch: { source: 'test' } });
  await createWebinarStarsExperienceProvider({ store: unmatchedStore, config }).createExperienceUrl({ user: unmatchedUser });
  const unmatchedClient = { getReports: async () => ({ reports: [{ report_id: 9, webinar_id: 32439, date_start: start, date_end: end }] }), getReport: async () => ({ report_id: 9, webinar_id: 32439, date_start: start, date_end: end, visitors: [{ visitor_id: 8, utm: 'utm_content=bbbbbbbbbbbbbbbb' }] }) };
  const result = await createWebinarStarsSyncScheduler({ store: unmatchedStore, client: unmatchedClient, config, now: () => retryClock.value, workerId: 'worker-unmatched' }).run();
  assert.equal(result.unmatched, 1);
  assert.equal(unmatchedStore.listProviderVisitors()[0].correlationStatus, 'unmatched');
  assert.equal(unmatchedStore.listUserEvents(unmatchedUser.id).some((event) => event.eventType.startsWith('webinarstars_')), false);
});
