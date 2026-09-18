export function databasePoolOptions(env = process.env, { production = env.FUNNEL_MODE === 'production' } = {}) {
  if (!env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required');
  const max = Number(env.DATABASE_POOL_MAX ?? 10);
  const connectionTimeoutMillis = Number(env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5000);
  const applicationName = env.DATABASE_APPLICATION_NAME?.trim() || 'men-funnel';
  const sslMode = env.DATABASE_SSL_MODE ?? (production ? 'verify-full' : 'disable');
  if (!Number.isInteger(max) || max < 1 || max > 50) throw new Error('DATABASE_POOL_MAX must be 1..50');
  if (!Number.isInteger(connectionTimeoutMillis) || connectionTimeoutMillis < 100 || connectionTimeoutMillis > 60_000) {
    throw new Error('DATABASE_CONNECTION_TIMEOUT_MS must be 100..60000');
  }
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(applicationName)) throw new Error('DATABASE_APPLICATION_NAME is invalid');
  if (!['disable', 'verify-full'].includes(sslMode) || (production && sslMode !== 'verify-full')) {
    throw new Error('Production DATABASE_SSL_MODE=verify-full is required');
  }
  let url;
  try { url = new URL(env.DATABASE_URL); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be PostgreSQL');
  if (production) {
    if (['men_funnel_staging', 'men_funnel_staging_e2e', 'men_funnel_test'].includes(decodeURIComponent(url.pathname.slice(1)))) {
      throw new Error('Production DATABASE_URL must use a separate database');
    }
    if (url.searchParams.has('sslmode') || url.searchParams.has('sslcert') || url.searchParams.has('sslkey')) {
      throw new Error('Production DATABASE_URL SSL options must be configured separately');
    }
  }
  return Object.freeze({ max, connectionTimeoutMillis, application_name: applicationName,
    ssl: sslMode === 'verify-full' ? { rejectUnauthorized: true } : false });
}
