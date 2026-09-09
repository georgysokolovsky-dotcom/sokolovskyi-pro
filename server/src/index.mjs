import { MemoryStore } from './store/memory-store.mjs';
import { PostgresStore } from './store/postgres-store.mjs';
import { localFixture } from './data/local-fixture.mjs';
import { createMenWebinarFlow } from './flow/men-webinar.mjs';
import { createApp } from './http/app.mjs';
import { createDevTelegramTransport } from './telegram/transport.mjs';
import { createTelegramBotApiTransport } from './telegram/bot-api-transport.mjs';
import { getTelegramBotIdentity } from './telegram/bot-api-admin.mjs';
import { loadRuntimeConfig } from './config/runtime-config.mjs';

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

let store;
if (config.storeMode === 'memory') {
  store = new MemoryStore();
} else {
  store = new PostgresStore({ connectionString: config.databaseUrl });
}
await store.seed(localFixture);

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
  transport,
});
const app = createApp({ flow, mode: config.mode, webhookSecret: config.webhookSecret, adminKey: config.adminSecret });

app.listen(config.port, config.host, () => {
  console.log(`Funnel server started in ${config.mode} mode with ${config.storeMode} store`);
});

async function shutdown() {
  await new Promise((resolve) => app.close(resolve));
  if (typeof store.close === 'function') await store.close();
}
process.once('SIGINT', async () => { await shutdown(); process.exit(0); });
process.once('SIGTERM', async () => { await shutdown(); process.exit(0); });
