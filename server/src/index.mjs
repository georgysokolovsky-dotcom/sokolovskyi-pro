import { MemoryStore } from './store/memory-store.mjs';
import { PostgresStore } from './store/postgres-store.mjs';
import { localFixture } from './data/local-fixture.mjs';
import { createMenWebinarFlow } from './flow/men-webinar.mjs';
import { createApp } from './http/app.mjs';
import { createDevTelegramTransport } from './telegram/transport.mjs';
import { createTelegramBotApiTransport } from './telegram/bot-api-transport.mjs';
import { guardTelegramOutbound } from './telegram/outbound-guard.mjs';
import { getTelegramBotIdentity } from './telegram/bot-api-admin.mjs';
import { loadRuntimeConfig } from './config/runtime-config.mjs';
import { createLocalPlaybackSourceProvider } from './webinar/providers/local-playback-source.mjs';
import { createMuxMediaSource } from './webinar/providers/mux-media-source.mjs';
import { createInternalExperienceProvider, createWebinarStarsExperienceProvider } from './webinarstars/experience-provider.mjs';

const config = loadRuntimeConfig();
let transport;
if (config.telegramTransportMode === 'dev') {
  transport = createDevTelegramTransport();
} else {
  transport = createTelegramBotApiTransport({
    fetchImpl: globalThis.fetch,
    baseUrl: config.botApiBaseUrl,
    botToken: config.botToken,
    timeoutMs: config.timeoutMs,
  });
}
if ((config.mode === 'staging' && config.webinarExperienceProvider === 'webinarstars') || config.mode === 'production') {
  transport = guardTelegramOutbound(transport, {
    enabled: config.mode !== 'production' || config.telegramOutboundEnabled,
    allowedTelegramUserId: config.allowedTelegramUserId,
  });
}

let store;
if (config.storeMode === 'memory') {
  store = new MemoryStore();
} else {
  store = new PostgresStore({ connectionString: config.databaseUrl, poolOptions: config.databasePoolOptions });
}
await store.seed(localFixture);

const playbackSourceProvider = config.webinarMediaProvider === 'mux'
  ? createMuxMediaSource({
      keyId: config.muxSigningKeyId,
      privateKey: config.muxSigningPrivateKey,
      playbackId: config.muxPlaybackId,
      tokenTtlSeconds: config.muxPlaybackTokenTtlSeconds,
      playbackBufferSeconds: config.muxPlaybackBufferSeconds,
    })
  : createLocalPlaybackSourceProvider();
const experienceProvider = config.webinarExperienceProvider === 'webinarstars'
  ? createWebinarStarsExperienceProvider({ store, config: config.webinarStars })
  : createInternalExperienceProvider();

if (config.mode !== 'local') {
  const identity = await getTelegramBotIdentity({
    fetchImpl: globalThis.fetch,
    baseUrl: config.botApiBaseUrl,
    botToken: config.botToken,
    timeoutMs: config.timeoutMs,
  });
  if (identity.username.toLowerCase() !== config.expectedBotUsername.toLowerCase()) {
    await store.close();
    throw new Error('Telegram bot identity does not match TELEGRAM_EXPECTED_BOT_USERNAME');
  }
}

const flow = createMenWebinarFlow({
  store,
  signingSecret: config.signingSecret,
  botUsername: config.expectedBotUsername ?? config.botUsername ?? localFixture.telegramBotUsername,
  entryNotice: localFixture.entryNotice,
  webinarBaseUrl: config.webinarBaseUrl,
  applicationReference: config.mode === 'staging' && config.webinarExperienceProvider === 'webinarstars'
    ? `${new URL(config.webhookUrl).origin}/application`
    : config.mode === 'production' ? `${config.publicApplicationOrigin}/application` : 'lab://men-funnel/application',
  applicationConsentVersion: config.applicationConsentVersion,
  transport,
  playbackSourceProvider,
  experienceProvider,
});
const app = createApp({ flow, mode: config.mode, webhookSecret: config.webhookSecret, adminKey: config.adminSecret,
  allowedTelegramUserId: config.mode !== 'local' ? config.allowedTelegramUserId : null,
  telegramOutboundEnabled: config.mode !== 'production' || config.telegramOutboundEnabled,
  adminApiEnabled: config.mode !== 'production' || config.adminApiEnabled,
  privacyPolicyUrl: config.privacyPolicyUrl, applicationConsentVersion: config.applicationConsentVersion,
  applicationConsentText: config.applicationConsentText,
  logger: config.mode === 'production' ? { info: (entry) => console.log(JSON.stringify(entry)) } : null });

app.listen(config.port, config.host, () => {
  console.log(`Funnel server started in ${config.mode} mode with ${config.storeMode} store`);
});

async function shutdown() {
  await new Promise((resolve) => app.close(resolve));
  if (typeof store.close === 'function') await store.close();
}
process.once('SIGINT', async () => { await shutdown(); process.exit(0); });
process.once('SIGTERM', async () => { await shutdown(); process.exit(0); });
