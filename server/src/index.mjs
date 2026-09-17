import { MemoryStore } from './store/memory-store.mjs';
import { PostgresStore } from './store/postgres-store.mjs';
import { localFixture } from './data/local-fixture.mjs';
import { createMenWebinarFlow } from './flow/men-webinar.mjs';
import { createApp } from './http/app.mjs';
import { createDevTelegramTransport } from './telegram/transport.mjs';
import { createTelegramBotApiTransport } from './telegram/bot-api-transport.mjs';
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
if (config.mode === 'staging' && config.webinarExperienceProvider === 'webinarstars') {
  const underlyingTransport = transport;
  transport = Object.freeze({
    provider: underlyingTransport.provider,
    async sendMessage(payload) {
      if (String(payload.telegramChatId) !== config.allowedTelegramUserId) {
        throw new Error('staging_chat_not_allowed');
      }
      return underlyingTransport.sendMessage(payload);
    },
  });
}

let store;
if (config.storeMode === 'memory') {
  store = new MemoryStore();
} else {
  store = new PostgresStore({ connectionString: config.databaseUrl });
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

if (config.mode === 'staging') {
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
    : 'lab://men-funnel/application',
  transport,
  playbackSourceProvider,
  experienceProvider,
});
const app = createApp({ flow, mode: config.mode, webhookSecret: config.webhookSecret, adminKey: config.adminSecret,
  allowedTelegramUserId: config.mode === 'staging' && config.webinarExperienceProvider === 'webinarstars' ? config.allowedTelegramUserId : null });

app.listen(config.port, config.host, () => {
  console.log(`Funnel server started in ${config.mode} mode with ${config.storeMode} store`);
});

async function shutdown() {
  await new Promise((resolve) => app.close(resolve));
  if (typeof store.close === 'function') await store.close();
}
process.once('SIGINT', async () => { await shutdown(); process.exit(0); });
process.once('SIGTERM', async () => { await shutdown(); process.exit(0); });
