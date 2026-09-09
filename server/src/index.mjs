import { MemoryStore } from './store/memory-store.mjs';
import { localFixture } from './data/local-fixture.mjs';
import { createMenWebinarFlow } from './flow/men-webinar.mjs';
import { createApp } from './http/app.mjs';
import { createDevTelegramTransport } from './telegram/transport.mjs';
import { createTelegramBotApiTransport } from './telegram/bot-api-transport.mjs';

const mode = process.env.FUNNEL_MODE ?? 'local';
if (mode !== 'local') throw new Error('Only FUNNEL_MODE=local is available before PostgreSQL setup');

const requiredSecrets = ['TOKEN_SIGNING_SECRET', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_SESSION_SECRET'];
const missingSecrets = requiredSecrets.filter((name) => !process.env[name]);
if (missingSecrets.length) throw new Error(`Missing required environment variables: ${missingSecrets.join(', ')}`);

const telegramTransportMode = process.env.TELEGRAM_TRANSPORT ?? 'dev';
let transport;
if (telegramTransportMode === 'dev') {
  transport = createDevTelegramTransport();
} else if (telegramTransportMode === 'bot-api') {
  const botApiConfig = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_API_BASE_URL'];
  const missingBotApiConfig = botApiConfig.filter((name) => !process.env[name]);
  if (missingBotApiConfig.length) throw new Error(`Missing required environment variables: ${missingBotApiConfig.join(', ')}`);
  transport = createTelegramBotApiTransport({
    fetchImpl: globalThis.fetch,
    baseUrl: process.env.TELEGRAM_BOT_API_BASE_URL,
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    timeoutMs: Number(process.env.TELEGRAM_TIMEOUT_MS ?? 5000),
  });
} else {
  throw new Error('TELEGRAM_TRANSPORT must be dev or bot-api');
}

const store = new MemoryStore();
store.seed(localFixture);
const flow = createMenWebinarFlow({
  store,
  signingSecret: process.env.TOKEN_SIGNING_SECRET,
  botUsername: process.env.TELEGRAM_BOT_USERNAME ?? localFixture.telegramBotUsername,
  entryNotice: localFixture.entryNotice,
  webinarBaseUrl: process.env.WEBINAR_BASE_URL || null,
  transport,
});
const app = createApp({ flow, mode, webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET, adminKey: process.env.ADMIN_SESSION_SECRET });
const port = Number(process.env.PORT ?? 8787);

app.listen(port, '127.0.0.1', () => {
  console.log(`Funnel server local fixture listening on http://127.0.0.1:${port}`);
});
