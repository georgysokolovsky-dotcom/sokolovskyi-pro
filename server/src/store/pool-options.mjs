import { X509Certificate } from 'node:crypto';

function decodeCertificateBase64(value) {
  const encoded = value?.trim();
  if (!encoded) throw new Error('DATABASE_SSL_CA_BASE64 is required for production verify-full');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('DATABASE_SSL_CA_BASE64 must be valid base64');
  }
  const certificate = Buffer.from(encoded, 'base64').toString('utf8').trim();
  if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----$/.test(certificate)) {
    throw new Error('DATABASE_SSL_CA_BASE64 must contain one PEM certificate');
  }
  try {
    const parsed = new X509Certificate(certificate);
    if (!parsed.ca) throw new Error('certificate is not a CA');
  } catch {
    throw new Error('DATABASE_SSL_CA_BASE64 must contain a valid PEM CA certificate');
  }
  return `${certificate}\n`;
}

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
    if ([...url.searchParams.keys()].some((name) => name.toLowerCase().startsWith('ssl'))) {
      throw new Error('Production DATABASE_URL SSL options must be configured separately');
    }
  }
  let ssl = false;
  if (sslMode === 'verify-full') {
    const encodedCa = env.DATABASE_SSL_CA_BASE64?.trim();
    const ca = encodedCa ? decodeCertificateBase64(encodedCa) : null;
    if (production && !ca) throw new Error('DATABASE_SSL_CA_BASE64 is required for production verify-full');
    ssl = ca ? Object.freeze({ rejectUnauthorized: true, ca }) : Object.freeze({ rejectUnauthorized: true });
  }
  return Object.freeze({ max, connectionTimeoutMillis, application_name: applicationName,
    ssl });
}
