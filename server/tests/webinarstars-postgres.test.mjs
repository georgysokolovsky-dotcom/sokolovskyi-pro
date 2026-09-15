import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createCorrelationToken } from '../src/webinarstars/correlation.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { createWebinarStarsSyncScheduler } from '../src/webinarstars/sync-scheduler.mjs';

const { Pool } = pg;
const connectionString = process.env.FUNNEL_TEST_DATABASE_URL;
const integrationTest = connectionString ? test : test.skip;

integrationTest('PostgreSQL persists WebinarStars correlation, claims concurrently and ingests visitors once', async (t) => {
  const schema = `men_webinarstars_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 2 });
  await admin.query(`create schema ${schema}`);
  const pools = [];
  const makeStore = () => {
    const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
    pools.push(pool);
    return new PostgresStore({ pool });
  };
  t.after(async () => {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });
  const storeA = makeStore();
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrationsUrl)).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
    await storeA.pool.query(await readFile(new URL(name, migrationsUrl), 'utf8'));
  }
  await storeA.seed(localFixture);
  const source = await storeA.findSourceByStartParameter(localFixture.funnel.id, 'article_wife_cheating');
  const touch = { sourceId: source.id, source: source.source, medium: source.medium, campaign: source.campaign, content: source.content, articleSlug: source.articleSlug, startParameter: source.startParameter, occurredAt: '2026-09-15T19:00:00Z' };
  const claimed = await storeA.claimTelegramStart({ source, telegramUserId: 81001, telegramChatId: 81001, firstName: null, username: null, languageCode: null, firstTouch: touch, funnelEntryTouch: touch, eventMetadata: {}, eventKey: 'pg-webinarstars-entry', updateId: 81001, occurredAt: touch.occurredAt });

  const config = { correlationSecret: 'postgres-webinarstars-secret', webinarId: '32439', registrationUrl: 'https://provider.invalid/register', scheduledStart: '2026-09-15T20:00:00Z', scheduledEnd: '2026-09-15T21:00:00Z', pollOffsetsMinutes: [0,1,3,5,10,15], targetCtaShowNumbers: ['2'], shortPresenceSeconds: 300, substantialPresenceRatio: 0.5 };
  const experience = createWebinarStarsExperienceProvider({ store: storeA, config });
  const firstUrl = await experience.createExperienceUrl({ user: claimed.user });
  await storeA.close();

  const storeB = makeStore();
  const storeC = makeStore();
  const repeatedUrl = await createWebinarStarsExperienceProvider({ store: storeB, config }).createExperienceUrl({ user: claimed.user });
  assert.equal(firstUrl.url, repeatedUrl.url);
  const token = createCorrelationToken(claimed.user.id, config.correlationSecret);
  const client = {
    getReports: async () => ({ reports: [{ report_id: 397771, webinar_id: 32439, date_start: config.scheduledStart, date_end: config.scheduledEnd }] }),
    getReport: async () => ({ report_id: 397771, webinar_id: 32439, visitors: [{ visitor_id: 5001, utm: `utm_content=${token}`, date_start: '2026-09-15T20:02:00Z', date_end: '2026-09-15T20:32:00Z', buttons_info: [{ type: 'button', show_number: 2, status: 'clicked' }], comments: [{ text: 'discard me' }] }] }),
  };
  const now = () => new Date(config.scheduledEnd);
  const [a, b] = await Promise.all([
    createWebinarStarsSyncScheduler({ store: storeB, client, config, now, workerId: 'pg-a' }).run(),
    createWebinarStarsSyncScheduler({ store: storeC, client, config, now, workerId: 'pg-b' }).run(),
  ]);
  assert.equal(a.completed + b.completed, 1);
  const visitors = await storeB.listProviderVisitors();
  assert.equal(visitors.length, 1);
  assert.equal(visitors[0].correlationStatus, 'matched');
  assert.equal(JSON.stringify(visitors).includes(token), false);
  assert.equal(JSON.stringify(visitors).includes('discard me'), false);
  const events = await storeB.listUserEvents(claimed.user.id);
  assert.equal(events.filter((event) => event.eventType === 'webinarstars_cta_clicked').length, 1);
  assert.equal(events.some((event) => /^watched_/.test(event.eventType)), false);
});
