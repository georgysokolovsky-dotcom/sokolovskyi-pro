import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createDevTelegramTransport } from '../src/telegram/transport.mjs';

const { Pool } = pg;
const connectionString = process.env.FUNNEL_TEST_DATABASE_URL;
const integrationTest = connectionString ? test : test.skip;

function createStore(schema) {
  return new PostgresStore({ pool: new Pool({ connectionString, max: 1, options: `-c search_path=${schema}` }) });
}

function createFlow(store, deliveries) {
  return createMenWebinarFlow({
    store,
    signingSecret: 'postgres-integration-signing-secret',
    botUsername: localFixture.telegramBotUsername,
    entryNotice: localFixture.entryNotice,
    webinarBaseUrl: 'http://127.0.0.1:9999/webinar',
    transport: createDevTelegramTransport({ sendMessage: async ({ message }) => {
      deliveries.push(message.role);
      return { ok: true, messageId: `postgres-${deliveries.length}` };
    } }),
  });
}

integrationTest('Postgres store persists the full funnel and suppresses update delivery after restart', async (t) => {
  const schema = `men_funnel_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 1 });
  const stores = [];
  await admin.query(`create schema ${schema}`);
  t.after(async () => {
    await Promise.allSettled(stores.map((store) => store.close()));
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });

  const migrationPool = new Pool({ connectionString, max: 1, options: `-c search_path=${schema}` });
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrationsUrl)).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
    await migrationPool.query(await readFile(new URL(name, migrationsUrl), 'utf8'));
  }
  await migrationPool.end();

  const firstDeliveries = [];
  const storeA = createStore(schema);
  stores.push(storeA);
  await storeA.seed(localFixture);
  const processingSource = await storeA.findSourceByStartParameter('men_webinar_v1', 'instagram_men_webinar');
  const processingTouch = {
    sourceId: processingSource.id,
    source: processingSource.source,
    medium: processingSource.medium,
    campaign: processingSource.campaign,
    content: processingSource.content,
    articleSlug: null,
    startParameter: processingSource.startParameter,
    occurredAt: '2026-09-10T10:00:00.000Z',
  };
  await storeA.claimTelegramStart({
    source: processingSource,
    telegramUserId: 6999,
    telegramChatId: 6999,
    firstName: 'State',
    username: null,
    languageCode: 'ru',
    firstTouch: processingTouch,
    funnelEntryTouch: processingTouch,
    eventMetadata: { source_id: processingSource.id },
    eventKey: 'telegram-update:122',
    updateId: 122,
    occurredAt: processingTouch.occurredAt,
  });
  assert.equal((await storeA.getTelegramUpdate('men_webinar_v1', 122)).status, 'processing');
  await storeA.finishTelegramUpdate({ funnelId: 'men_webinar_v1', updateId: 122, status: 'failed', errorStage: 'entry_notice', errorCode: 'controlled_test_error' });
  const failedUpdate = await storeA.getTelegramUpdate('men_webinar_v1', 122);
  assert.equal(failedUpdate.status, 'failed');
  assert.equal(failedUpdate.errorStage, 'entry_notice');
  assert.equal(failedUpdate.errorCode, 'controlled_test_error');
  const flowA = createFlow(storeA, firstDeliveries);
  const first = await flowA.handleTelegramStart({ telegramUserId: 7001, firstName: 'Restart', languageCode: 'ru', startParameter: 'article_wife_cheating', updateId: 123 });
  assert.deepEqual(firstDeliveries, ['entry_notice', 'bonus', 'webinar_invite']);
  assert.equal((await storeA.getTelegramUpdate('men_webinar_v1', 123)).status, 'completed');
  await flowA.recordTokenEvent({ token: first.webinar.token, eventType: 'cta_clicked', idempotencyKey: 'postgres-cta', metadata: { placement: 'webinar' } });
  const applicationToken = await flowA.createApplicationToken({ token: first.webinar.token });
  await flowA.submitApplication({ token: applicationToken.token, idempotencyKey: 'postgres-application', answers: { name: 'Test', situation: 'Persistent situation', email: 'ignored@example.com' }, consent: { accepted: true, policyVersion: 'test-1', source: 'integration-test' } });
  await flowA.requestDataDeletion({ telegramUserId: 7001 });
  await storeA.close();

  const restartDeliveries = [];
  const storeB = createStore(schema);
  stores.push(storeB);
  const flowB = createFlow(storeB, restartDeliveries);
  const repeated = await flowB.handleTelegramStart({ telegramUserId: 7001, firstName: 'Restart', languageCode: 'ru', startParameter: 'article_wife_cheating', updateId: 123 });
  assert.equal(repeated.duplicate, true);
  assert.deepEqual(restartDeliveries, []);
  const lead = await flowB.leadDetails(first.userId);
  assert.equal(lead.attribution.first_touch.source, 'google');
  assert.equal(lead.attribution.funnel_entry_touch.articleSlug, 'kak-perezhit-izmenu-zheny');
  assert.equal(lead.telegram.telegramChatId, '7001');
  assert.equal(lead.bonus.status, 'sent');
  assert.equal(lead.events.some((event) => event.eventType === 'webinar_invite_sent'), true);
  assert.deepEqual(lead.application.answers, { name: 'Test', situation: 'Persistent situation' });
  assert.equal(lead.deletionRequest.status, 'requested');

  const direct = await flowB.handleTelegramStart({ telegramUserId: 7001, firstName: 'Restart', languageCode: 'ru', startParameter: 'instagram_men_webinar', updateId: 124 });
  assert.equal(direct.attribution.first_touch.source, 'google');
  assert.equal(direct.attribution.funnel_entry_touch.source, 'google');

  const raceDeliveries = [];
  const raceFlow = createFlow(storeB, raceDeliveries);
  const raceInput = { telegramUserId: 7002, firstName: 'Race', languageCode: 'ru', startParameter: 'instagram_men_webinar', updateId: 125 };
  const raced = await Promise.all([raceFlow.handleTelegramStart(raceInput), raceFlow.handleTelegramStart(raceInput)]);
  assert.deepEqual(raced.map((item) => item.duplicate).sort(), [false, true]);
  assert.deepEqual(raceDeliveries, ['entry_notice', 'bonus', 'webinar_invite']);
  await storeB.close();
});
