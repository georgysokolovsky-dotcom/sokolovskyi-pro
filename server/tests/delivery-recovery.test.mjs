import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createDeliveryRecoveryExecutor } from '../src/delivery/recovery-executor.mjs';
import { TelegramTransportError } from '../src/telegram/transport.mjs';

const { Pool } = pg;
const connectionString = process.env.FUNNEL_TEST_DATABASE_URL;
const integrationTest = connectionString ? test : test.skip;

integrationTest('PostgreSQL recovery covers crash, retry, suppression and concurrent claims', async (t) => {
  const schema = `men_recovery_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 2 });
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
  const store = new PostgresStore({ pool });
  t.after(async () => {
    await store.close();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrationsUrl)).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
    await pool.query(await readFile(new URL(name, migrationsUrl), 'utf8'));
  }
  await store.seed(localFixture);

  let sequence = 20_000;
  async function seedOperation(messageType = 'bonus') {
    sequence += 1;
    const source = await store.findSourceByStartParameter('men_webinar_v1', 'article_wife_cheating');
    const occurredAt = new Date(Date.UTC(2026, 8, 10, 12, 0, sequence % 60)).toISOString();
    const touch = { sourceId: source.id, source: source.source, medium: source.medium, campaign: source.campaign, content: source.content, articleSlug: source.articleSlug, startParameter: source.startParameter, occurredAt };
    const claim = await store.claimTelegramStart({ source, telegramUserId: sequence, telegramChatId: sequence, firstName: null, username: null, languageCode: null, firstTouch: touch, funnelEntryTouch: touch, eventMetadata: { source_id: source.id }, eventKey: `telegram-update:${sequence}`, updateId: sequence, occurredAt });
    const operation = await store.createDeliveryOperation({ operationKey: `test:${sequence}:${messageType}`, funnelId: source.funnelId, userId: claim.user.id, telegramUpdateId: sequence, telegramChatId: sequence, messageType, descriptor: { templateName: 'test' }, maxAttempts: 2 });
    return { user: claim.user, operation };
  }

  function executor({ sent, errors = [], workerId, now = () => new Date(Date.now() + 1000) }) {
    return createDeliveryRecoveryExecutor({
      store, workerId, now, leaseMs: 1000, baseDelayMs: 100,
      resolveMessage: async () => ({ role: 'bonus', text: 'recovery-test', buttons: [] }),
      transport: { provider: 'fake', async sendMessage(payload) {
        sent.push(payload.telegramChatId);
        const error = errors.shift();
        if (error) throw error;
        return { ok: true, provider: 'fake', messageId: `receipt-${sent.length}` };
      } },
    });
  }

  await t.test('A pending operation is delivered once after restart; B delivered is never resent', async () => {
    const { operation } = await seedOperation();
    const sent = [];
    await executor({ sent, workerId: 'restart-a' }).run({ operationId: operation.id });
    assert.equal((await store.getDeliveryOperation(operation.id)).status, 'delivered');
    await executor({ sent, workerId: 'restart-b' }).run({ operationId: operation.id });
    assert.equal(sent.length, 1);
  });

  await t.test('a prepared dependent chain resumes in order after restart', async () => {
    const first = await seedOperation('entry_notice');
    const second = await store.createDeliveryOperation({ operationKey: `${first.operation.operationKey}:bonus`, funnelId: first.user.funnelId, userId: first.user.id, telegramUpdateId: first.operation.telegramUpdateId, telegramChatId: first.operation.telegramChatId, messageType: 'bonus', dependsOnOperationId: first.operation.id });
    await store.createDeliveryOperation({ operationKey: `${first.operation.operationKey}:invite`, funnelId: first.user.funnelId, userId: first.user.id, telegramUpdateId: first.operation.telegramUpdateId, telegramChatId: first.operation.telegramChatId, messageType: 'webinar_invite', dependsOnOperationId: second.id });
    const sent = [];
    const result = await executor({ sent, workerId: 'chain-restart' }).run({ limit: 3 });
    assert.equal(result.claimed, 3);
    assert.equal(sent.length, 3);
    assert.deepEqual((await store.listDeliveryOperations({ userId: first.user.id })).map((item) => item.status), ['delivered', 'delivered', 'delivered']);
  });

  await t.test('C expired pre-request lease can be reclaimed safely', async () => {
    const { operation } = await seedOperation();
    const base = new Date(Date.now() + 1000);
    await store.claimDeliveryOperation({ workerId: 'dead-worker', leaseMs: 1000, operationId: operation.id, now: base.toISOString() });
    const sent = [];
    await executor({ sent, workerId: 'reclaimer', now: () => new Date(base.getTime() + 2000) }).run({ operationId: operation.id });
    assert.equal(sent.length, 1);
    assert.equal((await store.getDeliveryOperation(operation.id)).status, 'delivered');
  });

  await t.test('D temporary HTTP failure retries only after backoff', async () => {
    const { operation } = await seedOperation();
    const clock = { value: new Date(Date.now() + 1000) };
    const sent = [];
    const errors = [new TelegramTransportError('telegram_http_error', 'safe', 500)];
    const first = executor({ sent, errors, workerId: 'retry-a', now: () => clock.value });
    await first.run({ operationId: operation.id });
    assert.equal((await store.getDeliveryOperation(operation.id)).status, 'retryable_failed');
    await executor({ sent, workerId: 'retry-too-early', now: () => clock.value }).run({ operationId: operation.id });
    assert.equal(sent.length, 1);
    clock.value = new Date(clock.value.getTime() + 1000);
    await executor({ sent, workerId: 'retry-b', now: () => clock.value }).run({ operationId: operation.id });
    assert.equal(sent.length, 2);
    assert.equal((await store.getDeliveryOperation(operation.id)).status, 'delivered');
  });

  await t.test('E permanent error dead-letters without retry', async () => {
    const { operation } = await seedOperation();
    const sent = [];
    await executor({ sent, errors: [new TelegramTransportError('telegram_http_error', 'safe', 400)], workerId: 'permanent' }).run({ operationId: operation.id });
    assert.equal((await store.getDeliveryOperation(operation.id)).status, 'dead_letter');
    await executor({ sent, workerId: 'permanent-retry' }).run({ operationId: operation.id });
    assert.equal(sent.length, 1);
  });

  await t.test('F unknown outcome fails closed', async () => {
    const { operation } = await seedOperation();
    const sent = [];
    await executor({ sent, errors: [new TelegramTransportError('telegram_timeout')], workerId: 'unknown' }).run({ operationId: operation.id });
    assert.equal((await store.getDeliveryOperation(operation.id)).status, 'delivery_unknown');
    await executor({ sent, workerId: 'unknown-retry' }).run({ operationId: operation.id });
    assert.equal(sent.length, 1);
  });

  await t.test('expired lease after request start becomes unknown, and max attempts dead-letter', async () => {
    const ambiguous = await seedOperation();
    const base = new Date(Date.now() + 1000);
    await store.claimDeliveryOperation({ workerId: 'lost-after-request', leaseMs: 1000, operationId: ambiguous.operation.id, now: base.toISOString() });
    await store.markDeliveryAttemptStarted({ operationId: ambiguous.operation.id, workerId: 'lost-after-request' });
    const sent = [];
    await executor({ sent, workerId: 'unknown-lease', now: () => new Date(base.getTime() + 2000) }).run({ operationId: ambiguous.operation.id });
    assert.equal((await store.getDeliveryOperation(ambiguous.operation.id)).status, 'delivery_unknown');
    assert.deepEqual(sent, []);

    const exhausted = await seedOperation();
    const clock = { value: new Date(Date.now() + 1000) };
    const errors = [
      new TelegramTransportError('telegram_http_error', 'safe', 500),
      new TelegramTransportError('telegram_http_error', 'safe', 500),
    ];
    const attempts = [];
    await executor({ sent: attempts, errors, workerId: 'max-a', now: () => clock.value }).run({ operationId: exhausted.operation.id });
    clock.value = new Date(clock.value.getTime() + 1000);
    await executor({ sent: attempts, errors, workerId: 'max-b', now: () => clock.value }).run({ operationId: exhausted.operation.id });
    assert.equal((await store.getDeliveryOperation(exhausted.operation.id)).status, 'dead_letter');
    assert.equal(attempts.length, 2);
  });

  await t.test('G stop, H deletion and sold status suppress before transport', async () => {
    const stopped = await seedOperation();
    const deleted = await seedOperation();
    const sold = await seedOperation();
    await store.setPromotionalEnabled(stopped.user.id, false, new Date().toISOString());
    await store.requestDataDeletion({ userId: deleted.user.id, funnelId: deleted.user.funnelId });
    await store.updateUser(sold.user.id, { leadStatus: 'sold' });
    const sent = [];
    await executor({ sent, workerId: 'suppress-stop' }).run({ operationId: stopped.operation.id });
    await executor({ sent, workerId: 'suppress-delete' }).run({ operationId: deleted.operation.id });
    await executor({ sent, workerId: 'suppress-sold' }).run({ operationId: sold.operation.id });
    assert.equal((await store.getDeliveryOperation(stopped.operation.id)).status, 'suppressed');
    assert.equal((await store.getDeliveryOperation(deleted.operation.id)).status, 'suppressed');
    assert.equal((await store.getDeliveryOperation(sold.operation.id)).status, 'suppressed');
    assert.deepEqual(sent, []);
  });

  await t.test('I concurrent executors send one operation at most once', async () => {
    const { operation } = await seedOperation();
    const sent = [];
    const make = (workerId) => createDeliveryRecoveryExecutor({
      store, workerId, resolveMessage: async () => ({ text: 'race', buttons: [] }),
      transport: { async sendMessage() { sent.push(workerId); await new Promise((resolve) => setTimeout(resolve, 20)); return { provider: 'fake', messageId: workerId }; } },
    });
    await Promise.all([make('race-a').run({ operationId: operation.id }), make('race-b').run({ operationId: operation.id })]);
    assert.equal(sent.length, 1);
    assert.equal((await store.getDeliveryOperation(operation.id)).status, 'delivered');
  });
});
