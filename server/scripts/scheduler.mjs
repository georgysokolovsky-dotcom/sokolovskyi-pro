import { randomUUID } from 'node:crypto';
import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { createTelegramBotApiTransport } from '../src/telegram/bot-api-transport.mjs';
import { getTelegramBotIdentity } from '../src/telegram/bot-api-admin.mjs';
import { createWebinarStarsClient } from '../src/webinarstars/client.mjs';
import { createWebinarStarsSyncScheduler } from '../src/webinarstars/sync-scheduler.mjs';
import { createInternalExperienceProvider, createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';

const config = loadRuntimeConfig();
if (config.storeMode !== 'postgres' || config.telegramTransportMode !== 'bot-api') {
  throw new Error('Scheduler requires explicit FUNNEL_STORE=postgres and TELEGRAM_TRANSPORT=bot-api');
}

const store = new PostgresStore({ connectionString: config.databaseUrl });
const logger = { info: (entry) => console.log(JSON.stringify(entry)) };
try {
  await store.seed(localFixture);
  if (config.mode === 'staging') {
    const identity = await getTelegramBotIdentity({ fetchImpl: globalThis.fetch, baseUrl: config.botApiBaseUrl, botToken: config.botToken, timeoutMs: config.timeoutMs });
    if (identity.username.toLowerCase() !== config.expectedBotUsername.toLowerCase()) throw new Error('Telegram bot identity does not match TELEGRAM_EXPECTED_BOT_USERNAME');
  }
  const flow = createMenWebinarFlow({
    store,
    signingSecret: config.signingSecret,
    botUsername: config.expectedBotUsername ?? config.botUsername ?? localFixture.telegramBotUsername,
    entryNotice: localFixture.entryNotice,
    webinarBaseUrl: config.webinarBaseUrl,
    warmingPolicy: localFixture.warmingPolicy,
    transport: createTelegramBotApiTransport({ fetchImpl: globalThis.fetch, baseUrl: config.botApiBaseUrl, botToken: config.botToken, timeoutMs: config.timeoutMs }),
    schedulerOptions: { workerId: `manual-${randomUUID()}`, logger },
    experienceProvider: config.webinarExperienceProvider === 'webinarstars'
      ? createWebinarStarsExperienceProvider({ store, config: config.webinarStars })
      : createInternalExperienceProvider(),
  });
  await flow.runWarmingScheduler();
  if (config.webinarExperienceProvider === 'webinarstars') {
    const webinarStars = createWebinarStarsSyncScheduler({
      store,
      client: createWebinarStarsClient({ baseUrl: config.webinarStars.apiBaseUrl, apiToken: config.webinarStars.apiToken, timeoutMs: config.timeoutMs }),
      config: config.webinarStars,
      workerId: `manual-webinarstars-${randomUUID()}`,
      logger,
    });
    await webinarStars.run();
  }
} finally {
  await store.close();
}
