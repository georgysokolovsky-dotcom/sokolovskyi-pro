const modes = new Set(['local', 'staging']);
const storeModes = new Set(['memory', 'postgres']);
const transportModes = new Set(['dev', 'bot-api']);
const webinarMediaProviders = new Set(['local', 'mux']);

function required(env, names) {
  const missing = names.filter((name) => typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

function requireHttps(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must be a valid HTTPS URL`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query parameters or fragments`);
  }
  return url.toString().replace(/\/$/, '');
}

export function loadRuntimeConfig(env = process.env) {
  const mode = env.FUNNEL_MODE ?? 'local';
  const storeMode = env.FUNNEL_STORE ?? 'memory';
  const telegramTransportMode = env.TELEGRAM_TRANSPORT ?? 'dev';
  const webinarMediaProvider = env.WEBINAR_MEDIA_PROVIDER ?? 'local';
  if (!modes.has(mode)) throw new Error('FUNNEL_MODE must be local or staging');
  if (!storeModes.has(storeMode)) throw new Error('FUNNEL_STORE must be memory or postgres');
  if (!transportModes.has(telegramTransportMode)) throw new Error('TELEGRAM_TRANSPORT must be dev or bot-api');
  if (!webinarMediaProviders.has(webinarMediaProvider)) throw new Error('WEBINAR_MEDIA_PROVIDER must be local or mux');

  required(env, ['TOKEN_SIGNING_SECRET', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_SESSION_SECRET']);
  if (storeMode === 'postgres') required(env, ['DATABASE_URL']);
  if (telegramTransportMode === 'bot-api') required(env, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_API_BASE_URL']);
  if (webinarMediaProvider === 'mux') required(env, ['MUX_SIGNING_KEY_ID', 'MUX_SIGNING_PRIVATE_KEY', 'MUX_PLAYBACK_ID']);

  let webhookUrl = null;
  let webinarBaseUrl = env.WEBINAR_BASE_URL?.trim() || null;
  if (mode === 'staging') {
    if (storeMode !== 'postgres') throw new Error('FUNNEL_STORE=postgres is required for staging');
    if (telegramTransportMode !== 'bot-api') throw new Error('TELEGRAM_TRANSPORT=bot-api is required for staging');
    required(env, ['TELEGRAM_WEBHOOK_URL', 'TELEGRAM_EXPECTED_BOT_USERNAME', 'WEBINAR_BASE_URL']);
    if (env.TELEGRAM_BOT_API_BASE_URL.replace(/\/+$/, '') !== 'https://api.telegram.org') {
      throw new Error('Staging requires the official https://api.telegram.org Bot API endpoint');
    }
    webhookUrl = requireHttps(env.TELEGRAM_WEBHOOK_URL, 'TELEGRAM_WEBHOOK_URL');
    if (new URL(webhookUrl).pathname !== '/v1/webhooks/telegram') {
      throw new Error('TELEGRAM_WEBHOOK_URL must end with /v1/webhooks/telegram');
    }
    webinarBaseUrl = requireHttps(env.WEBINAR_BASE_URL, 'WEBINAR_BASE_URL');
  }

  const timeoutMs = Number(env.TELEGRAM_TIMEOUT_MS ?? 5000);
  const port = Number(env.PORT ?? 8787);
  const muxPlaybackTokenTtlSeconds = Number(env.MUX_PLAYBACK_TOKEN_TTL_SECONDS ?? 3600);
  const muxPlaybackBufferSeconds = Number(env.MUX_PLAYBACK_BUFFER_SECONDS ?? 600);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('TELEGRAM_TIMEOUT_MS must be a positive number');
  if (!Number.isInteger(muxPlaybackTokenTtlSeconds) || muxPlaybackTokenTtlSeconds <= 0) throw new Error('MUX_PLAYBACK_TOKEN_TTL_SECONDS must be a positive integer');
  if (!Number.isInteger(muxPlaybackBufferSeconds) || muxPlaybackBufferSeconds < 0) throw new Error('MUX_PLAYBACK_BUFFER_SECONDS must be a non-negative integer');

  return Object.freeze({
    mode,
    storeMode,
    telegramTransportMode,
    webinarMediaProvider,
    host: env.HOST?.trim() || (mode === 'staging' ? '0.0.0.0' : '127.0.0.1'),
    port,
    timeoutMs,
    webinarBaseUrl,
    webhookUrl,
    botUsername: env.TELEGRAM_BOT_USERNAME?.trim() || null,
    expectedBotUsername: env.TELEGRAM_EXPECTED_BOT_USERNAME?.trim().replace(/^@/, '') || null,
    databaseUrl: env.DATABASE_URL?.trim() || null,
    botApiBaseUrl: env.TELEGRAM_BOT_API_BASE_URL?.trim() || null,
    botToken: env.TELEGRAM_BOT_TOKEN?.trim() || null,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    signingSecret: env.TOKEN_SIGNING_SECRET,
    adminSecret: env.ADMIN_SESSION_SECRET,
    muxSigningKeyId: env.MUX_SIGNING_KEY_ID?.trim() || null,
    muxSigningPrivateKey: env.MUX_SIGNING_PRIVATE_KEY || null,
    muxPlaybackId: env.MUX_PLAYBACK_ID?.trim() || null,
    muxPlaybackTokenTtlSeconds,
    muxPlaybackBufferSeconds,
  });
}
