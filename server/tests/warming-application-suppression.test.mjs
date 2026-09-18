import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createDeliveryRecoveryExecutor, getDeliverySuppressionReason } from '../src/delivery/recovery-executor.mjs';

const { Pool } = pg;
const connectionString = process.env.FUNNEL_TEST_DATABASE_URL;
const integrationTest = connectionString ? test : test.skip;

integrationTest('application suppresses internal warming before transport across due, restart and concurrent workers', async (t) => {
  const schema = `men_application_warming_${randomUUID().replaceAll('-', '')}`;
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
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
    await store.pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await store.seed(localFixture);

  const clock = { value: new Date('2026-09-18T12:00:00Z') };
  let sequence = 70_000;
  const sent = [];
  const makeFlow = (targetStore = store) => createMenWebinarFlow({
    store: targetStore, signingSecret: 'application-warming-test',
    botUsername: localFixture.telegramBotUsername, entryNotice: localFixture.entryNotice,
    now: () => clock.value, schedulerOptions: { now: () => clock.value, random: () => 0 },
    recoveryOptions: { now: () => clock.value },
    transport: { provider: 'fake', async sendMessage(payload) {
      sent.push(payload.message.role);
      return { provider: 'fake', messageId: `fake-${sent.length}` };
    } },
  });
  const start = async () => {
    sequence += 1;
    const started = await makeFlow().handleTelegramStart({
      telegramUserId: sequence, startParameter: 'article_wife_cheating', updateId: sequence,
      timestamp: clock.value.toISOString(),
    });
    const operations = (await store.listDeliveryOperations({ userId: started.userId })).filter((item) => item.messageType === 'warming');
    assert.deepEqual(operations.map((item) => item.descriptor.ruleName).sort(), ['webinar_reminder_15m', 'webinar_reminder_3h']);
    assert.ok(operations.every((item) => item.descriptor.stopAfterApplication === true));
    sent.length = 0;
    return { started, operations };
  };
  const submit = async (started, targetStore = store) => targetStore.createApplicationWithEvent({
    userId: started.userId, funnelId: started.funnelId, answers: { name: 'Test', situation: 'Test' },
    consent: { policyVersion: 'test' }, idempotencyKey: `application:${started.userId}:${started.funnelId}`,
  });
  const due = (operations) => { clock.value = new Date(Math.max(...operations.map((item) => new Date(item.earliestExecutionAt).getTime())) + 1); };
  const state = async (operations, targetStore = store) => Promise.all(operations.map(async (item) => targetStore.getDeliveryOperation(item.id)));

  await t.test('application before due proactively cancels both reminders and keeps transport unused', async () => {
    const { started, operations } = await start();
    await store.pool.query("update delivery_operations set descriptor=descriptor-'stopAfterApplication' where id=any($1::uuid[])", [operations.map((item) => item.id)]);
    await submit(started);
    assert.ok((await state(operations)).every((item) => item.status === 'cancelled' && item.cancellationReason === 'application_submitted'));
    assert.equal(await getDeliverySuppressionReason(store, started.userId, started.funnelId,
      { messageType: 'entry_notice', messageClass: 'funnel_service', descriptor: {} }), null);
    due(operations);
    assert.equal((await makeFlow().runWarmingScheduler()).delivered, 0);
    assert.deepEqual(sent, []);
  });

  await t.test('already-due reminders are cancelled by application before scheduler execution', async () => {
    const { started, operations } = await start();
    due(operations);
    await submit(started);
    assert.ok((await state(operations)).every((item) => item.status === 'cancelled'));
    assert.equal((await makeFlow().runWarmingScheduler()).claimed, 0);
    assert.deepEqual(sent, []);
  });

  await t.test('application committed after delivery claim but before transport is caught by final gate', async () => {
    const { started, operations } = await start();
    due(operations);
    const workerId = `claimed-${randomUUID()}`;
    const claimed = await store.claimScheduledOperation({ funnelId: started.funnelId, workerId, leaseMs: 30_000, now: clock.value.toISOString() });
    assert.ok(claimed);
    await store.finishScheduledOperation({ operationId: claimed.id, workerId, status: 'pending' });
    let transportCalls = 0;
    const executor = createDeliveryRecoveryExecutor({
      store, now: () => clock.value,
      resolveMessage: async () => {
        await submit(started);
        return { role: 'warming', text: 'fake', buttons: [] };
      },
      transport: { async sendMessage() { transportCalls += 1; throw new Error('transport_must_not_run'); } },
    });
    await executor.run({ operationId: claimed.id, limit: 1 });
    const saved = await store.getDeliveryOperation(claimed.id);
    assert.equal(saved.status, 'suppressed');
    assert.equal(saved.cancellationReason, 'application_submitted');
    assert.equal(transportCalls, 0);
    assert.ok((await state(operations)).every((item) => ['cancelled', 'suppressed'].includes(item.status)));
  });

  await t.test('restart and two concurrent schedulers cannot send after application', async () => {
    const { started, operations } = await start();
    due(operations);
    await submit(started);
    const restarted = makeStore();
    const [a, b] = await Promise.all([makeFlow(restarted).runWarmingScheduler(), makeFlow(store).runWarmingScheduler()]);
    assert.equal(a.delivered + b.delivered, 0);
    assert.deepEqual(sent, []);
    assert.ok((await state(operations, restarted)).every((item) => item.status === 'cancelled'));
  });

  for (const [label, suppress] of [
    ['sold', async (started) => store.updateUser(started.userId, { leadStatus: 'sold' })],
    ['stop', async (started) => store.setPromotionalEnabled(started.userId, false, clock.value.toISOString())],
    ['deletion', async (started) => store.requestDataDeletion({ userId: started.userId, funnelId: started.funnelId })],
  ]) {
    await t.test(`${label} remains a pre-send suppression with zero transport`, async () => {
      const { started, operations } = await start();
      due(operations);
      await suppress(started);
      await makeFlow().runWarmingScheduler();
      assert.deepEqual(sent, []);
      assert.ok((await state(operations)).every((item) => item.status === 'suppressed'));
    });
  }
});
