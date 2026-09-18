import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { databasePoolOptions } from '../src/store/pool-options.mjs';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to apply funnel migrations');

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();
const pool = new Pool({ connectionString, ...databasePoolOptions(process.env) });
let client;

try {
  client = await pool.connect();
  const lock = await client.query('select pg_try_advisory_lock(31415, 31195) as acquired');
  if (!lock.rows[0]?.acquired) throw new Error('Another MEN migration runner is active');
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query('alter table schema_migrations add column if not exists checksum text');
  for (const name of migrationFiles) {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = await client.query('select checksum from schema_migrations where name = $1', [name]);
    if (applied.rowCount) {
      // Pre-checksum staging history is preserved, not silently rewritten.
      if (applied.rows[0].checksum && applied.rows[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
      if (!applied.rows[0].checksum) console.log(`Legacy migration without checksum: ${name}`);
      continue;
    }
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name,checksum) values ($1,$2)', [name,checksum]);
      await client.query('commit');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
} finally {
  try { if (client) await client.query('select pg_advisory_unlock(31415, 31195)'); }
  finally { client?.release(); await pool.end(); }
}
