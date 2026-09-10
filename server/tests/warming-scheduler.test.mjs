import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createDevTelegramTransport, TelegramTransportError } from '../src/telegram/transport.mjs';

const { Pool } = pg;
const connectionString = process.env.FUNNEL_TEST_DATABASE_URL;
const integrationTest = connectionString ? test : test.skip;

integrationTest('PostgreSQL warming scheduler scenarios A-O', async (t) => {
  const schema = `men_scheduler_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 2 });
  await admin.query(`create schema ${schema}`);
  const pools = [];
  const makeStore = () => {
    const pool = new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
    pools.push(pool);
    return new PostgresStore({ pool });
  };
  const store = makeStore();
  t.after(async () => {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrationsUrl)).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
    await store.pool.query(await readFile(new URL(name, migrationsUrl), 'utf8'));
  }
  await store.seed(localFixture);

  const clock = { value: new Date(Date.now() + 60_000) };
  let updateId = 30_000;
  function makeFlow(targetStore, sent, { errors = [], workerId = randomUUID(), policy = localFixture.warmingPolicy, delay = 0, randomValue = 0 } = {}) {
    return createMenWebinarFlow({
      store: targetStore,
      signingSecret: 'scheduler-integration-signing-secret',
      botUsername: localFixture.telegramBotUsername,
      entryNotice: localFixture.entryNotice,
      webinarBaseUrl: 'http://127.0.0.1:9999/webinar',
      warmingPolicy: policy,
      recoveryOptions: { now: () => clock.value, workerId: `delivery-${workerId}` },
      schedulerOptions: { now: () => clock.value, random: () => randomValue, workerId: `scheduler-${workerId}` },
      transport: createDevTelegramTransport({ sendMessage: async ({ message }) => {
        sent.push(message.templateName);
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const error = errors.shift();
        if (error) throw error;
        return { ok: true, provider: 'fake', messageId: `message-${sent.length}` };
      } }),
    });
  }
  async function start(flow, telegramUserId = ++updateId) {
    updateId += 1;
    return flow.handleTelegramStart({ telegramUserId, startParameter: 'article_wife_cheating', updateId, timestamp: clock.value.toISOString() });
  }
  const warmingFor = async (userId) => (await store.listDeliveryOperations({ userId })).filter((item) => item.messageType === 'warming');

  await t.test('A and B: start schedules once and duplicate update does not duplicate schedule', async () => {
    const sent = [];
    const flow = makeFlow(store, sent, { workerId: 'ab' });
    const telegramUserId = 40_001;
    const result = await start(flow, telegramUserId);
    const firstCount = (await warmingFor(result.userId)).length;
    const repeated = await flow.handleTelegramStart({ telegramUserId, startParameter: 'article_wife_cheating', updateId, timestamp: clock.value.toISOString() });
    assert.equal(repeated.duplicate, true);
    assert.equal(firstCount, 2);
    assert.equal((await warmingFor(result.userId)).length, 2);
    await store.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
  });

  await t.test('deterministic jitter and per-entry schedule limit come from policy', async () => {
    const sent = [];
    const policy = { ...localFixture.warmingPolicy, maxScheduledPerFunnelEntry: 1 };
    const flow = makeFlow(store, sent, { workerId: 'jitter-limit', policy, randomValue: 0.5 });
    const result = await start(flow);
    const operations = await warmingFor(result.userId);
    assert.equal(operations.length, 1);
    assert.equal(new Date(operations[0].earliestExecutionAt).getTime() - new Date(operations[0].scheduledFor).getTime(), 30_000);
    await store.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
  });

  await t.test('C, D and F: not due sends nothing, due sends once, repeat sends no duplicate', async () => {
    const sent = [];
    const flow = makeFlow(store, sent, { workerId: 'cdf' });
    const result = await start(flow);
    sent.length = 0;
    const operations = await warmingFor(result.userId);
    clock.value = new Date(new Date(operations[0].earliestExecutionAt).getTime() - 1);
    assert.equal((await flow.runWarmingScheduler()).delivered, 0);
    assert.deepEqual(sent, []);
    clock.value = new Date(operations[0].earliestExecutionAt);
    assert.equal((await flow.runWarmingScheduler()).delivered, 1);
    assert.equal(sent.length, 1);
    assert.equal((await flow.runWarmingScheduler()).delivered, 0);
    assert.equal(sent.length, 1);
    await store.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
  });

  await t.test('E: due operation persists and executes after store restart', async () => {
    const firstSent = [];
    const firstFlow = makeFlow(store, firstSent, { workerId: 'restart-a' });
    const result = await start(firstFlow);
    const operation = (await warmingFor(result.userId))[0];
    clock.value = new Date(operation.earliestExecutionAt);
    const restartedStore = makeStore();
    const restartedSent = [];
    const restartedFlow = makeFlow(restartedStore, restartedSent, { workerId: 'restart-b' });
    assert.equal((await restartedFlow.runWarmingScheduler()).delivered, 1);
    assert.equal(restartedSent.length, 1);
    await restartedStore.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
  });

  await t.test('G: target event cancels reminder before scheduled time', async () => {
    const sent = [];
    const flow = makeFlow(store, sent, { workerId: 'target' });
    const result = await start(flow);
    sent.length = 0;
    await flow.recordTokenEvent({ token: result.webinar.token, eventType: 'webinar_started', idempotencyKey: `started-${result.userId}`, metadata: {} });
    const reminders = (await warmingFor(result.userId)).filter((item) => item.descriptor.ruleName.startsWith('webinar_reminder_'));
    assert.deepEqual(reminders.map((item) => item.status), ['cancelled', 'cancelled']);
    clock.value = new Date(Math.max(...reminders.map((item) => new Date(item.earliestExecutionAt).getTime())) + 1);
    await flow.runWarmingScheduler();
    assert.deepEqual(sent, []);
    await store.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
  });

  await t.test('continue watching waits six hours after the latest sub-50 activity', async () => {
    const sent = [];
    const flow = makeFlow(store, sent, { workerId: 'inactive-window' });
    const result = await start(flow);
    sent.length = 0;
    await flow.recordTokenEvent({ token: result.webinar.token, eventType: 'webinar_started', idempotencyKey: `inactive-started-${result.userId}`, metadata: {} });
    const operation = (await warmingFor(result.userId)).find((item) => item.descriptor.ruleName === 'continue_watching_6h');
    const watched = await flow.recordTokenEvent({ token: result.webinar.token, eventType: 'watched_25', idempotencyKey: `inactive-watched-${result.userId}`, metadata: { threshold: 25 } });
    const activityAt = new Date(new Date(operation.descriptor.triggeredAt).getTime() + 5 * 60 * 60 * 1000);
    await store.pool.query('update events set occurred_at=$2 where id=$1', [watched.event.id, activityAt.toISOString()]);
    clock.value = new Date(operation.earliestExecutionAt);
    const deferred = await flow.runWarmingScheduler();
    assert.equal(deferred.deferred, 1);
    assert.deepEqual(sent, []);
    const rescheduled = await store.getDeliveryOperation(operation.id);
    assert.equal(new Date(rescheduled.earliestExecutionAt).getTime(), activityAt.getTime() + 6 * 60 * 60 * 1000);
    clock.value = new Date(rescheduled.earliestExecutionAt);
    assert.equal((await flow.runWarmingScheduler()).delivered, 1);
    assert.equal(sent.length, 1);
  });

  for (const [label, action, reason] of [
    ['H stop', (flow, result) => flow.stopTelegramFlow({ telegramUserId: result.telegramUserId }), 'telegram_stop'],
    ['I deletion', (flow, result) => flow.requestDataDeletion({ telegramUserId: result.telegramUserId }), 'data_deletion_requested'],
  ]) {
    await t.test(`${label}: future warming is suppressed`, async () => {
      const sent = [];
      const flow = makeFlow(store, sent, { workerId: label });
      const telegramUserId = ++updateId;
      const result = await start(flow, telegramUserId);
      result.telegramUserId = telegramUserId;
      sent.length = 0;
      await action(flow, result);
      assert.deepEqual((await warmingFor(result.userId)).map((item) => item.status), ['suppressed', 'suppressed']);
      assert.deepEqual(sent, []);
      assert.equal((await warmingFor(result.userId))[0].lastErrorCode, reason);
    });
  }

  await t.test('J: sold status blocks due warming', async () => {
    const sent = [];
    const flow = makeFlow(store, sent, { workerId: 'sold' });
    const result = await start(flow);
    sent.length = 0;
    const operation = (await warmingFor(result.userId))[0];
    await store.updateUser(result.userId, { leadStatus: 'sold' });
    clock.value = new Date(operation.earliestExecutionAt);
    const scheduler = await flow.runWarmingScheduler();
    assert.equal(scheduler.suppressed, 1);
    assert.deepEqual(sent, []);
  });

  await t.test('K: concurrent schedulers send a due operation at most once', async () => {
    const sent = [];
    const seedFlow = makeFlow(store, sent, { workerId: 'race-seed' });
    const result = await start(seedFlow);
    sent.length = 0;
    clock.value = new Date((await warmingFor(result.userId))[0].earliestExecutionAt);
    const flowA = makeFlow(store, sent, { workerId: 'race-a', delay: 20 });
    const flowB = makeFlow(store, sent, { workerId: 'race-b', delay: 20 });
    await Promise.all([flowA.runWarmingScheduler(), flowB.runWarmingScheduler()]);
    assert.equal(sent.length, 1);
    await store.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
  });

  await t.test('L: activated delivery survives crash and recovery completes it once', async () => {
    const sent = [];
    const flow = makeFlow(store, sent, { workerId: 'crash-seed' });
    const result = await start(flow);
    sent.length = 0;
    const operation = (await warmingFor(result.userId))[0];
    clock.value = new Date(operation.earliestExecutionAt);
    const claimed = await store.claimScheduledOperation({ funnelId: result.funnelId, workerId: 'crashed-scheduler', leaseMs: 1000, now: clock.value.toISOString() });
    await store.finishScheduledOperation({ operationId: claimed.id, workerId: 'crashed-scheduler', status: 'pending' });
    const restartedStore = makeStore();
    const recoveryFlow = makeFlow(restartedStore, sent, { workerId: 'crash-recovery' });
    await recoveryFlow.runDeliveryRecovery({ operationId: operation.id });
    await recoveryFlow.runWarmingScheduler();
    assert.equal(sent.length, 1);
    assert.equal((await restartedStore.getDeliveryOperation(operation.id)).status, 'delivered');
    await restartedStore.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
  });

  await t.test('recovery revalidates target state after scheduler activation', async () => {
    const sent = [];
    const flow = makeFlow(store, sent, { workerId: 'revalidate-seed' });
    const result = await start(flow);
    sent.length = 0;
    const operation = (await warmingFor(result.userId))[0];
    clock.value = new Date(operation.earliestExecutionAt);
    const claimed = await store.claimScheduledOperation({ funnelId: result.funnelId, workerId: 'revalidate-crash', leaseMs: 1000, now: clock.value.toISOString() });
    await store.finishScheduledOperation({ operationId: claimed.id, workerId: 'revalidate-crash', status: 'pending' });
    await flow.recordTokenEvent({ token: result.webinar.token, eventType: 'webinar_started', idempotencyKey: `revalidate-${result.userId}`, metadata: {} });
    await flow.runDeliveryRecovery({ operationId: operation.id });
    assert.equal((await store.getDeliveryOperation(operation.id)).status, 'cancelled');
    assert.deepEqual(sent, []);
    await store.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
  });

  for (const [label, error, expected] of [
    ['M unknown', new TelegramTransportError('telegram_timeout'), 'delivery_unknown'],
    ['N dead letter', new TelegramTransportError('telegram_http_error', 'safe', 400), 'dead_letter'],
  ]) {
    await t.test(`${label}: scheduler does not repeat terminal delivery`, async () => {
      const sent = [];
      const errors = [];
      const seedFlow = makeFlow(store, sent, { workerId: `${label}-seed` });
      const result = await start(seedFlow);
      sent.length = 0;
      const operation = (await warmingFor(result.userId))[0];
      clock.value = new Date(operation.earliestExecutionAt);
      errors.push(error);
      const failingFlow = makeFlow(store, sent, { workerId: label, errors });
      await failingFlow.runWarmingScheduler();
      assert.equal((await store.getDeliveryOperation(operation.id)).status, expected);
      await failingFlow.runWarmingScheduler();
      assert.equal(sent.length, 1);
      await store.cancelScheduledWarming({ userId: result.userId, funnelId: result.funnelId, reason: 'test_cleanup' });
    });
  }

  await t.test('O: promotional message limit cancels excess delivery', async () => {
    const sent = [];
    const policy = { ...localFixture.warmingPolicy, maxPromotionalDelivered: 0 };
    const flow = makeFlow(store, sent, { workerId: 'limit', policy });
    const result = await start(flow);
    sent.length = 0;
    await flow.recordTokenEvent({ token: result.webinar.token, eventType: 'watched_75', idempotencyKey: `watched-75-${result.userId}`, metadata: { threshold: 75 } });
    const promotional = (await warmingFor(result.userId)).find((item) => item.messageClass === 'promotional');
    clock.value = new Date(promotional.earliestExecutionAt);
    const scheduler = await flow.runWarmingScheduler();
    assert.equal(scheduler.cancelled, 1);
    assert.equal((await store.getDeliveryOperation(promotional.id)).cancellationReason, 'promotional_message_limit');
    assert.deepEqual(sent, []);
  });
});
