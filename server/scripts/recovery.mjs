import { randomUUID } from 'node:crypto';
import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { createTelegramBotApiTransport } from '../src/telegram/bot-api-transport.mjs';
import { getTelegramBotIdentity } from '../src/telegram/bot-api-admin.mjs';
import { createInternalExperienceProvider, createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';

const config = loadRuntimeConfig();
if (config.storeMode !== 'postgres' || config.telegramTransportMode !== 'bot-api') {
  throw new Error('Recovery requires explicit FUNNEL_STORE=postgres and TELEGRAM_TRANSPORT=bot-api');
}

const store = new PostgresStore({ connectionString: config.databaseUrl });
const logger = { info: (entry) => console.log(JSON.stringify(entry)) };
try {
  await store.seed(localFixture);
  if (config.mode === 'staging') {
    const identity = await getTelegramBotIdentity({ fetchImpl: globalThis.fetch, baseUrl: config.botApiBaseUrl, botToken: config.botToken, timeoutMs: config.timeoutMs });
    if (identity.username.toLowerCase() !== config.expectedBotUsername.toLowerCase()) {
      throw new Error('Telegram bot identity does not match TELEGRAM_EXPECTED_BOT_USERNAME');
    }
  }
  const flow = createMenWebinarFlow({
    store,
    signingSecret: config.signingSecret,
    botUsername: config.expectedBotUsername ?? config.botUsername ?? localFixture.telegramBotUsername,
    entryNotice: localFixture.entryNotice,
    webinarBaseUrl: config.webinarBaseUrl,
    transport: createTelegramBotApiTransport({
      fetchImpl: globalThis.fetch,
      baseUrl: config.botApiBaseUrl,
      botToken: config.botToken,
      timeoutMs: config.timeoutMs,
    }),
    experienceProvider: config.webinarExperienceProvider === 'webinarstars'
      ? createWebinarStarsExperienceProvider({ store, config: config.webinarStars })
      : createInternalExperienceProvider(),
    recoveryOptions: { workerId: `manual-${randomUUID()}`, logger },
  });
  const result = await flow.runDeliveryRecovery();
  console.log(JSON.stringify({ event: 'delivery_recovery_complete', workerId: result.workerId, claimed: result.claimed }));
} finally {
  await store.close();
}
