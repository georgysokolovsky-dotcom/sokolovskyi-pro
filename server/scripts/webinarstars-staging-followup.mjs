import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { getTelegramBotIdentity } from '../src/telegram/bot-api-admin.mjs';
import { createTelegramBotApiTransport } from '../src/telegram/bot-api-transport.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { createMenApplicationUrlProvider } from '../src/application/access-url.mjs';
import { createWebinarStarsFollowUpScheduler } from '../src/webinarstars/lifecycle.mjs';
import { WEBINARSTARS_STAGING_FOLLOW_UP_TEMPLATES } from '../src/config/webinarstars-follow-up-templates.mjs';

const config = loadRuntimeConfig();
if (config.mode !== 'staging' || config.webinarExperienceProvider !== 'webinarstars' || !config.allowedTelegramUserId) {
  throw new Error('Explicit scoped WebinarStars staging configuration is required');
}
const store = new PostgresStore({ connectionString: config.databaseUrl });
try {
  const database = await store.pool.query('select current_database() as name');
  if (database.rows[0]?.name !== 'men_funnel_staging') throw new Error('Wrong staging database');
  const identity = await getTelegramBotIdentity({ fetchImpl: fetch, baseUrl: config.botApiBaseUrl, botToken: config.botToken, timeoutMs: config.timeoutMs });
  if (identity.username.toLowerCase() !== config.expectedBotUsername.toLowerCase()) throw new Error('Wrong staging bot');
  const user = await store.findUserByTelegramId(config.allowedTelegramUserId);
  const telegram = user && await store.getTelegramUser(user.id);
  if (!user || telegram?.telegramChatId !== config.allowedTelegramUserId) throw new Error('Controlled test account has not started this bot');
  const transport = createTelegramBotApiTransport({ fetchImpl: fetch, baseUrl: config.botApiBaseUrl, botToken: config.botToken, timeoutMs: config.timeoutMs });
  const guardedTransport = {
    async sendMessage(payload) {
      if (String(payload.telegramChatId) !== config.allowedTelegramUserId || payload.userId !== user.id) throw new Error('staging_chat_not_allowed');
      return transport.sendMessage(payload);
    },
  };
  const scheduler = createWebinarStarsFollowUpScheduler({
    store, config: config.webinarStars,
    experienceProvider: createWebinarStarsExperienceProvider({ store, config: config.webinarStars }),
    applicationUrlProvider: createMenApplicationUrlProvider({ signingSecret: config.signingSecret,
      applicationReference: `${new URL(config.webhookUrl).origin}/application` }),
    transport: guardedTransport, templates: WEBINARSTARS_STAGING_FOLLOW_UP_TEMPLATES, allowedUserId: user.id,
  });
  console.log(JSON.stringify(await scheduler.run({ limit: 1 })));
} finally {
  await store.close();
}
