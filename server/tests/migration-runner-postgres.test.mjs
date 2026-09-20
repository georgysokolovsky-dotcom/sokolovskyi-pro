import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const integrationTest = process.env.FUNNEL_TEST_DATABASE_URL ? test : test.skip;
const execFileAsync = promisify(execFile);

integrationTest('migration runner stores checksums, is idempotent and rejects drift', async (t) => {
  const schema = `men_migrate_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.FUNNEL_TEST_DATABASE_URL, max: 2 });
  await admin.query(`create schema ${schema}`);
  t.after(async () => {
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });
  const url = new URL(process.env.FUNNEL_TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const env = { ...process.env, FUNNEL_MODE: 'local', DATABASE_URL: url.toString() };
  const runner = () => execFileAsync(process.execPath, [fileURLToPath(new URL('../scripts/migrate.mjs', import.meta.url))], { env });
  await runner();
  const db = new pg.Pool({ connectionString: url.toString(), max: 2 });
  t.after(() => db.end());
  const first = await db.query('select name,checksum from schema_migrations order by name');
  assert.equal(first.rowCount, 8);
  assert.ok(first.rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum)));
  await runner();
  assert.deepEqual((await db.query('select name,checksum from schema_migrations order by name')).rows, first.rows);
  await db.query('update schema_migrations set checksum=$1 where name=$2', ['0'.repeat(64), first.rows[0].name]);
  await assert.rejects(runner(), /Migration checksum mismatch/);
});

integrationTest('008 upgrades a 001-007 database without changing legacy application answers', async (t) => {
  const schema = `men_upgrade_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.FUNNEL_TEST_DATABASE_URL, max: 2 });
  await admin.query(`create schema ${schema}`);
  t.after(async () => {
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });

  const url = new URL(process.env.FUNNEL_TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = new pg.Pool({ connectionString: url.toString(), max: 2 });
  t.after(() => db.end());
  const migrationUrl = (name) => new URL(`../migrations/${name}`, import.meta.url);

  for (const name of [
    '001_core.sql',
    '002_delivery_operations.sql',
    '003_delivery_dependencies.sql',
    '004_warming_scheduler.sql',
    '005_webinar_progress.sql',
    '006_webinarstars_provider.sql',
    '007_webinarstars_lifecycle.sql',
  ]) {
    await db.query(await readFile(migrationUrl(name), 'utf8'));
  }

  const funnelId = 'men_upgrade_test';
  const userId = randomUUID();
  const applicationId = randomUUID();
  await db.query(`insert into funnels (id,name,status) values ($1,'Upgrade test','active')`, [funnelId]);
  await db.query(`insert into users (id,funnel_id,lead_status) values ($1,$2,'application_submitted')`, [userId, funnelId]);
  await db.query(`insert into applications (id,user_id,funnel_id,status,answers,consent,privacy_policy_version,idempotency_key)
    values ($1,$2,$3,'submitted',$4,$5,'legacy-v1','legacy-application')`, [
    applicationId,
    userId,
    funnelId,
    JSON.stringify({ name: 'Legacy', situation: 'Existing staging situation' }),
    JSON.stringify({ accepted: true, policyVersion: 'legacy-v1', source: 'legacy-form' }),
  ]);

  await db.query(await readFile(migrationUrl('008_application_phone.sql'), 'utf8'));

  const legacy = (await db.query('select answers,phone from applications where id=$1', [applicationId])).rows[0];
  assert.deepEqual(legacy.answers, { name: 'Legacy', situation: 'Existing staging situation' });
  assert.equal(legacy.phone, null);
  await assert.rejects(
    db.query(`insert into applications (id,user_id,funnel_id,status,answers,phone,consent,privacy_policy_version,idempotency_key)
      values ($1,$2,$3,'submitted',$4,'not-a-phone',$5,'privacy-v1','invalid-phone')`, [
      randomUUID(), userId, funnelId, JSON.stringify({ name: 'New' }), JSON.stringify({ accepted: true }),
    ]),
    /applications_phone_normalized_check/,
  );
});
