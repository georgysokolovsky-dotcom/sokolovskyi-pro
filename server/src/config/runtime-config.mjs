const modes = new Set(['local', 'staging']);
const storeModes = new Set(['memory', 'postgres']);
const transportModes = new Set(['dev', 'bot-api']);
const webinarMediaProviders = new Set(['local', 'mux']);
const webinarExperienceProviders = new Set(['internal', 'webinarstars']);

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
  const webinarExperienceProvider = env.WEBINAR_EXPERIENCE_PROVIDER ?? 'internal';
  if (!modes.has(mode)) throw new Error('FUNNEL_MODE must be local or staging');
  if (!storeModes.has(storeMode)) throw new Error('FUNNEL_STORE must be memory or postgres');
  if (!transportModes.has(telegramTransportMode)) throw new Error('TELEGRAM_TRANSPORT must be dev or bot-api');
  if (!webinarMediaProviders.has(webinarMediaProvider)) throw new Error('WEBINAR_MEDIA_PROVIDER must be local or mux');
  if (!webinarExperienceProviders.has(webinarExperienceProvider)) throw new Error('WEBINAR_EXPERIENCE_PROVIDER must be internal or webinarstars');

  required(env, ['TOKEN_SIGNING_SECRET', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_SESSION_SECRET']);
  if (storeMode === 'postgres') required(env, ['DATABASE_URL']);
  if (telegramTransportMode === 'bot-api') required(env, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_API_BASE_URL']);
  if (webinarMediaProvider === 'mux') required(env, ['MUX_SIGNING_KEY_ID', 'MUX_SIGNING_PRIVATE_KEY', 'MUX_PLAYBACK_ID']);
  if (webinarExperienceProvider === 'webinarstars') {
    required(env, [
      'DATABASE_URL', 'WEBINARSTARS_API_BASE_URL', 'WEBINARSTARS_API_TOKEN',
      'WEBINARSTARS_CORRELATION_SECRET', 'WEBINARSTARS_WEBINAR_ID',
      'WEBINARSTARS_REGISTRATION_URL', 'WEBINARSTARS_SCHEDULED_START', 'WEBINARSTARS_SCHEDULED_END',
      'WEBINARSTARS_TIME_ZONE',
    ]);
    if (storeMode !== 'postgres') throw new Error('FUNNEL_STORE=postgres is required for WebinarStars experience provider');
  }

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
    if (webinarExperienceProvider === 'webinarstars' && !/^[1-9][0-9]{4,19}$/.test(env.STAGING_ALLOWED_TELEGRAM_USER_ID ?? '')) {
      throw new Error('STAGING_ALLOWED_TELEGRAM_USER_ID is required for live WebinarStars staging');
    }
  }

  const timeoutMs = Number(env.TELEGRAM_TIMEOUT_MS ?? 5000);
  const port = Number(env.PORT ?? 8787);
  const muxPlaybackTokenTtlSeconds = Number(env.MUX_PLAYBACK_TOKEN_TTL_SECONDS ?? 3600);
  const muxPlaybackBufferSeconds = Number(env.MUX_PLAYBACK_BUFFER_SECONDS ?? 600);
  const webinarStarsPollOffsetsMinutes = String(env.WEBINARSTARS_POLL_OFFSETS_MINUTES ?? '0,1,3,5,10,15')
    .split(',').map((value) => Number(value.trim()));
  const webinarStarsTargetCtaShowNumbers = String(env.WEBINARSTARS_TARGET_CTA_SHOW_NUMBERS ?? '1,2')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const webinarStarsOfferBoundarySeconds = Number(env.WEBINARSTARS_OFFER_BOUNDARY_SECONDS ?? 3300);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('TELEGRAM_TIMEOUT_MS must be a positive number');
  if (!Number.isInteger(muxPlaybackTokenTtlSeconds) || muxPlaybackTokenTtlSeconds <= 0) throw new Error('MUX_PLAYBACK_TOKEN_TTL_SECONDS must be a positive integer');
  if (!Number.isInteger(muxPlaybackBufferSeconds) || muxPlaybackBufferSeconds < 0) throw new Error('MUX_PLAYBACK_BUFFER_SECONDS must be a non-negative integer');
  if (!webinarStarsPollOffsetsMinutes.length || webinarStarsPollOffsetsMinutes.some((value, index) => !Number.isInteger(value) || value < 0 || (index && value <= webinarStarsPollOffsetsMinutes[index - 1]))) {
    throw new Error('WEBINARSTARS_POLL_OFFSETS_MINUTES must be increasing non-negative integers');
  }
  if (!Number.isInteger(webinarStarsOfferBoundarySeconds) || webinarStarsOfferBoundarySeconds < 0) throw new Error('WEBINARSTARS_OFFER_BOUNDARY_SECONDS must be a non-negative integer');

  let webinarStars = null;
  if (webinarExperienceProvider === 'webinarstars') {
    const timeZone = env.WEBINARSTARS_TIME_ZONE.trim();
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(timeZone) || timeZone.startsWith('Etc/')) {
      throw new Error('WEBINARSTARS_TIME_ZONE must be a valid IANA time zone');
    }
    try { new Intl.DateTimeFormat('en', { timeZone }); }
    catch { throw new Error('WEBINARSTARS_TIME_ZONE must be a valid IANA time zone'); }
    for (const name of ['WEBINARSTARS_SCHEDULED_START', 'WEBINARSTARS_SCHEDULED_END']) {
      if (!/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(env[name])) {
        throw new Error(`${name} must include an explicit UTC offset`);
      }
    }
    const scheduledStart = new Date(env.WEBINARSTARS_SCHEDULED_START);
    const scheduledEnd = new Date(env.WEBINARSTARS_SCHEDULED_END);
    if (!Number.isFinite(scheduledStart.getTime()) || !Number.isFinite(scheduledEnd.getTime()) || scheduledEnd <= scheduledStart) throw new Error('WebinarStars scheduled start/end must be valid and increasing');
    webinarStars = Object.freeze({
      apiBaseUrl: requireHttps(env.WEBINARSTARS_API_BASE_URL, 'WEBINARSTARS_API_BASE_URL'),
      apiToken: env.WEBINARSTARS_API_TOKEN,
      correlationSecret: env.WEBINARSTARS_CORRELATION_SECRET,
      webinarId: String(env.WEBINARSTARS_WEBINAR_ID),
      registrationUrl: requireHttps(env.WEBINARSTARS_REGISTRATION_URL, 'WEBINARSTARS_REGISTRATION_URL'),
      timeZone,
      scheduledStart: scheduledStart.toISOString(), scheduledEnd: scheduledEnd.toISOString(),
      pollOffsetsMinutes: webinarStarsPollOffsetsMinutes,
      targetCtaShowNumbers: webinarStarsTargetCtaShowNumbers,
      offerBoundarySeconds: webinarStarsOfferBoundarySeconds,
    });
  }

  return Object.freeze({
    mode,
    storeMode,
    telegramTransportMode,
    webinarMediaProvider,
    webinarExperienceProvider,
    webinarStars,
    host: env.HOST?.trim() || (mode === 'staging' ? '0.0.0.0' : '127.0.0.1'),
    port,
    timeoutMs,
    webinarBaseUrl,
    webhookUrl,
    allowedTelegramUserId: env.STAGING_ALLOWED_TELEGRAM_USER_ID?.trim() || null,
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
