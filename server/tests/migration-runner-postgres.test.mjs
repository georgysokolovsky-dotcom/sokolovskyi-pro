import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
  assert.equal(first.rowCount, 7);
  assert.ok(first.rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum)));
  await runner();
  assert.deepEqual((await db.query('select name,checksum from schema_migrations order by name')).rows, first.rows);
  await db.query('update schema_migrations set checksum=$1 where name=$2', ['0'.repeat(64), first.rows[0].name]);
  await assert.rejects(runner(), /Migration checksum mismatch/);
});
