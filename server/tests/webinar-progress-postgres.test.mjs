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

integrationTest('PostgreSQL persists real webinar progress across restart and concurrent tabs', async (t) => {
  const schema = `men_webinar_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 2 });
  await admin.query(`create schema ${schema}`);
  const pools = [];
  const makeStore = () => {
    const pool = new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
    pools.push(pool);
    return new PostgresStore({ pool });
  };
  t.after(async () => {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });
  const migrationStore = makeStore();
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrationsUrl)).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
    await migrationStore.pool.query(await readFile(new URL(name, migrationsUrl), 'utf8'));
  }
  await migrationStore.seed(localFixture);

  const clock = { value: new Date(Date.now() + 60_000) };
  const makeFlow = (store, worker) => createMenWebinarFlow({
    store, signingSecret: 'postgres-webinar-progress-secret', botUsername: localFixture.telegramBotUsername,
    entryNotice: localFixture.entryNotice, webinarBaseUrl: 'http://127.0.0.1/webinar',
    transport: createDevTelegramTransport(), now: () => clock.value,
    schedulerOptions: { now: () => clock.value, random: () => 0, workerId: `scheduler-${worker}` },
    recoveryOptions: { now: () => clock.value, workerId: `recovery-${worker}` },
  });
  const telemetry = (flow, token, session, action, position, requestId = randomUUID()) => flow.ingestWebinarTelemetry({
    token, clientSessionId: session, requestId, action, positionSeconds: position, durationSeconds: 40,
  });

  const storeA = migrationStore;
  const flowA = makeFlow(storeA, 'a');
  const started = await flowA.handleTelegramStart({ telegramUserId: 61_001, startParameter: 'article_wife_cheating', updateId: 61_001, timestamp: clock.value.toISOString() });
  await flowA.openWebinarPage({ token: started.webinar.token, videoId: localFixture.webinar.videoId });
  const tabA = randomUUID();
  await telemetry(flowA, started.webinar.token, tabA, 'play', 0);
  const reminders = (await storeA.listDeliveryOperations({ userId: started.userId })).filter((operation) => operation.descriptor?.ruleName?.startsWith('webinar_reminder_'));
  assert.deepEqual(reminders.map((operation) => operation.status), ['cancelled', 'cancelled']);
  clock.value = new Date(clock.value.getTime() + 10_000);
  await telemetry(flowA, started.webinar.token, tabA, 'heartbeat', 10);
  let events = await storeA.listUserEvents(started.userId);
  assert.equal(events.filter((event) => event.eventType === 'webinar_started').length, 1);
  assert.equal(events.filter((event) => event.eventType === 'watched_25').length, 1);
  const initialContinue = (await storeA.listDeliveryOperations({ userId: started.userId })).find((operation) => operation.descriptor?.ruleName === 'continue_watching_6h');
  const playbackClock = clock.value;
  clock.value = new Date(initialContinue.earliestExecutionAt);
  assert.equal((await flowA.runWarmingScheduler()).deferred, 1);
  assert.ok(new Date((await storeA.getDeliveryOperation(initialContinue.id)).earliestExecutionAt) > new Date(initialContinue.earliestExecutionAt));
  clock.value = playbackClock;

  await storeA.close();
  const storeB = makeStore();
  const storeC = makeStore();
  const flowB = makeFlow(storeB, 'b');
  const flowC = makeFlow(storeC, 'c');
  const tabB = randomUUID();
  await telemetry(flowB, started.webinar.token, tabB, 'play', 10);
  clock.value = new Date(clock.value.getTime() + 10_000);
  await telemetry(flowB, started.webinar.token, tabB, 'heartbeat', 20);
  const continueOperation = (await storeB.listDeliveryOperations({ userId: started.userId })).find((operation) => operation.descriptor?.ruleName === 'continue_watching_6h');
  assert.equal(continueOperation.status, 'cancelled');

  clock.value = new Date(clock.value.getTime() + 10_000);
  const requestId = randomUUID();
  const results = await Promise.all([
    telemetry(flowB, started.webinar.token, tabB, 'heartbeat', 30, requestId),
    telemetry(flowC, started.webinar.token, tabB, 'heartbeat', 30, requestId),
  ]);
  assert.deepEqual(results.map((result) => result.duplicate).sort(), [false, true]);
  events = await storeB.listUserEvents(started.userId);
  assert.equal(events.filter((event) => event.eventType === 'watched_25').length, 1);
  assert.equal(events.filter((event) => event.eventType === 'watched_50').length, 1);
  assert.equal(events.filter((event) => event.eventType === 'watched_75').length, 1);
  const followUps = (await storeB.listDeliveryOperations({ userId: started.userId })).filter((operation) => operation.descriptor?.ruleName === 'application_follow_up_2h');
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].status, 'scheduled');

  await flowB.recordWebinarCta({ token: started.webinar.token, requestId: randomUUID() });
  assert.equal((await storeB.getDeliveryOperation(followUps[0].id)).status, 'cancelled');
  await storeB.close();
  await storeC.close();

  const storeD = makeStore();
  const flowD = makeFlow(storeD, 'd');
  const lead = await flowD.leadDetails(started.userId);
  assert.equal(lead.webinar.maxProgress, 75);
  assert.equal(lead.webinar.events.filter((event) => event.eventType === 'watched_75').length, 1);
  assert.equal((await storeD.listDeliveryOperations({ userId: started.userId })).filter((operation) => operation.descriptor?.ruleName === 'application_follow_up_2h').length, 1);
});
