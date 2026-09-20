import pg from 'pg';
import { databasePoolOptions } from '../src/store/pool-options.mjs';

const { Pool } = pg;

function failureCategory(error) {
  if (/DATABASE_|production verify-full/i.test(error?.message ?? '')) return 'CONFIGURATION';
  if (['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'TLS_STATE_INVALID'].includes(error?.code)) return 'TLS_AUTHORIZATION';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(error?.code)) return 'NETWORK';
  if (String(error?.code ?? '').match(/^[0-9A-Z]{5}$/)) return 'DATABASE';
  return 'UNEXPECTED';
}

let pool;
let client;

try {
  if (process.env.FUNNEL_MODE !== 'production') throw new Error('Production database TLS probe requires FUNNEL_MODE=production');
  const connectionString = process.env.DATABASE_URL?.trim();
  const poolOptions = databasePoolOptions(process.env, { production: true });
  pool = new Pool({ connectionString, ...poolOptions, max: 1 });
  client = await pool.connect();
  const result = await client.query('SELECT 1 AS result');
  const socket = client.connection?.stream;
  if (result.rows[0]?.result !== 1 || socket?.encrypted !== true || socket?.authorized !== true) {
    throw Object.assign(new Error('Database TLS verification did not pass'), { code: 'TLS_STATE_INVALID' });
  }
  console.log('DATABASE TLS PROBE: PASS');
} catch (error) {
  console.error(`DATABASE TLS PROBE: FAIL (${failureCategory(error)})`);
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end().catch(() => {});
}
