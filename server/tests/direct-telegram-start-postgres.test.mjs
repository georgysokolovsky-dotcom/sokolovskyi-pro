import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createApp } from '../src/http/app.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';

const integrationTest = process.env.FUNNEL_TEST_DATABASE_URL ? test : test.skip;

integrationTest('PostgreSQL plain /start persists one direct entry and survives a repeated webhook update after restart', async (t) => {
  const schema = `men_direct_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.FUNNEL_TEST_DATABASE_URL, max: 2 });
  const pool = new pg.Pool({ connectionString: process.env.FUNNEL_TEST_DATABASE_URL, max: 8, options: `-c search_path=${schema}` });
  let created = false;
  t.after(async () => {
    await pool.end();
    if (created) await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });
  await admin.query(`create schema ${schema}`);
  created = true;
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
    await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const store = new PostgresStore({ pool });
  await store.seed(localFixture);
  const sent = [];
  const config = {
    correlationSecret: 'postgres-direct-correlation-fixture', webinarId: '31195',
    registrationUrl: 'https://provider.invalid/webinar/fixture/',
    scheduledStart: '2026-09-17T16:00:00Z', scheduledEnd: '2026-09-17T17:31:00Z', pollOffsetsMinutes: [0, 1, 3, 5, 10, 15],
  };
  const flow = createMenWebinarFlow({
    store, signingSecret: 'postgres-direct-signing-fixture', botUsername: 'staging_fixture_bot',
    experienceProvider: createWebinarStarsExperienceProvider({ store, config }),
    transport: { async sendMessage(payload) {
      sent.push(payload);
      return { provider: 'fake', messageId: `fake-${sent.length}` };
    } },
  });
  const webhookSecret = 'postgres-direct-webhook-fixture';
  async function listen(allowedTelegramUserId) {
    const app = createApp({ flow, mode: 'staging', webhookSecret, allowedTelegramUserId });
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
    return { app, base: `http://127.0.0.1:${app.address().port}` };
  }
  async function webhook(base, id, updateId, text) {
    const response = await fetch(`${base}/v1/webhooks/telegram`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookSecret },
      body: JSON.stringify({ update_id: updateId, message: { from: { id }, text } }),
    });
    return { status: response.status, body: await response.json() };
  }

  const firstServer = await listen('123456789');
  const first = await webhook(firstServer.base, 123456789, 88100, '/start');
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, false);
  await new Promise((resolve) => firstServer.app.close(resolve));
  const user = await store.findUserByTelegramId(123456789);
  assert.equal(user.firstTouch.source, 'direct');
  assert.equal(user.firstTouch.articleSlug, null);
  assert.equal(user.funnelEntryTouch.source, 'direct');
  assert.equal((await store.getTelegramUpdate(user.funnelId, 88100)).status, 'completed');
  assert.equal((await store.listUserEvents(user.id)).filter((item) => item.eventType === 'telegram_start').length, 1);
  const operations = (await store.listDeliveryOperations({ userId: user.id })).filter((item) => ['entry_notice', 'bonus', 'webinar_invite'].includes(item.messageType));
  assert.deepEqual(operations.map((item) => item.messageType), ['entry_notice', 'bonus', 'webinar_invite']);
  assert.ok(operations.every((item) => item.status === 'delivered' && item.attemptCount === 1 && item.providerMessageId));
  const allOperations = await store.listDeliveryOperations({ userId: user.id });
  assert.equal(sent.length, 3);
  assert.equal(Number((await pool.query('select count(*) as n from users')).rows[0].n), 1);
  assert.equal(Number((await pool.query('select count(*) as n from telegram_updates')).rows[0].n), 1);
  assert.equal(Number((await pool.query('select count(*) as n from provider_correlations')).rows[0].n), 1);
  assert.equal(Number((await pool.query('select count(*) as n from provider_session_entries')).rows[0].n), 1);

  const restartedServer = await listen('123456789');
  t.after(() => restartedServer.app.close());
  const repeated = await webhook(restartedServer.base, 123456789, 88100, '/start');
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.duplicate, true);
  assert.equal(Number((await pool.query('select count(*) as n from users')).rows[0].n), 1);
  assert.equal(Number((await pool.query('select count(*) as n from telegram_updates')).rows[0].n), 1);
  assert.equal(Number((await pool.query('select count(*) as n from provider_correlations')).rows[0].n), 1);
  assert.equal((await store.listDeliveryOperations({ userId: user.id })).length, allOperations.length);
  assert.equal(sent.length, 3);

  const ignored = await webhook(restartedServer.base, 999999999, 88101, '/start');
  assert.deepEqual(ignored, { status: 200, body: { ok: true, ignored: true } });
  assert.equal(Number((await pool.query('select count(*) as n from users')).rows[0].n), 1);
});
