import { randomUUID } from 'node:crypto';
import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { createTelegramBotApiTransport } from '../src/telegram/bot-api-transport.mjs';
import { getTelegramBotIdentity } from '../src/telegram/bot-api-admin.mjs';
import { createWebinarStarsClient } from '../src/webinarstars/client.mjs';
import { createWebinarStarsSyncScheduler } from '../src/webinarstars/sync-scheduler.mjs';
import { createWebinarStarsLifecycle } from '../src/webinarstars/lifecycle.mjs';
import { createInternalExperienceProvider, createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { guardTelegramOutbound } from '../src/telegram/outbound-guard.mjs';

const config = loadRuntimeConfig();
if (config.storeMode !== 'postgres' || config.telegramTransportMode !== 'bot-api') {
  throw new Error('Scheduler requires explicit FUNNEL_STORE=postgres and TELEGRAM_TRANSPORT=bot-api');
}

const store = new PostgresStore({ connectionString: config.databaseUrl, poolOptions: config.databasePoolOptions });
const logger = { info: (entry) => console.log(JSON.stringify(entry)) };
try {
  await store.seed(localFixture);
  if (config.mode !== 'local') {
    const identity = await getTelegramBotIdentity({ fetchImpl: globalThis.fetch, baseUrl: config.botApiBaseUrl, botToken: config.botToken, timeoutMs: config.timeoutMs });
    if (identity.username.toLowerCase() !== config.expectedBotUsername.toLowerCase()) throw new Error('Telegram bot identity does not match TELEGRAM_EXPECTED_BOT_USERNAME');
  }
  const transport = guardTelegramOutbound(createTelegramBotApiTransport({ fetchImpl: globalThis.fetch, baseUrl: config.botApiBaseUrl, botToken: config.botToken, timeoutMs: config.timeoutMs }),
    { enabled: config.mode !== 'production' || config.telegramOutboundEnabled, allowedTelegramUserId: config.mode === 'production' ? config.allowedTelegramUserId : null });
  const flow = createMenWebinarFlow({
    store,
    signingSecret: config.signingSecret,
    botUsername: config.expectedBotUsername ?? config.botUsername ?? localFixture.telegramBotUsername,
    entryNotice: localFixture.entryNotice,
    webinarBaseUrl: config.webinarBaseUrl,
    warmingPolicy: localFixture.warmingPolicy,
    transport,
    schedulerOptions: { workerId: `manual-${randomUUID()}`, logger },
    experienceProvider: config.webinarExperienceProvider === 'webinarstars'
      ? createWebinarStarsExperienceProvider({ store, config: config.webinarStars })
      : createInternalExperienceProvider(),
  });
  if (config.mode !== 'production' || config.telegramOutboundEnabled) await flow.runWarmingScheduler();
  else console.log(JSON.stringify({ event: 'warming_scheduler_skipped', reason: 'telegram_outbound_disabled' }));
  if (config.webinarExperienceProvider === 'webinarstars' && (config.mode !== 'production' || config.webinarStarsSyncEnabled)) {
    const webinarStars = createWebinarStarsSyncScheduler({
      store,
      client: createWebinarStarsClient({ baseUrl: config.webinarStars.apiBaseUrl, apiToken: config.webinarStars.apiToken, timeoutMs: config.timeoutMs }),
      config: config.webinarStars,
      lifecycle: createWebinarStarsLifecycle({ store, config: config.webinarStars, logger }),
      workerId: `manual-webinarstars-${randomUUID()}`,
      logger,
    });
    const summary = await webinarStars.run();
    console.log(JSON.stringify({ event: 'webinarstars_sync_summary', ...summary }));
  } else if (config.mode === 'production') {
    console.log(JSON.stringify({ event: 'webinarstars_sync_skipped', reason: 'sync_disabled' }));
  }
} finally {
  await store.close();
}
