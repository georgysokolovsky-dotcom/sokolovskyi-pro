import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { getTelegramBotIdentity } from '../src/telegram/bot-api-admin.mjs';
import { createTelegramBotApiTransport } from '../src/telegram/bot-api-transport.mjs';
import { guardTelegramOutbound } from '../src/telegram/outbound-guard.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { createMenApplicationUrlProvider } from '../src/application/access-url.mjs';
import { createWebinarStarsFollowUpScheduler } from '../src/webinarstars/lifecycle.mjs';
import { APPROVED_WEBINARSTARS_FOLLOW_UP_TEMPLATES } from '../src/config/webinarstars-follow-up-templates.mjs';

const config = loadRuntimeConfig();
if (config.mode !== 'production') throw new Error('Production follow-up worker requires FUNNEL_MODE=production');
if (!config.webinarStarsFollowUpEnabled || !config.telegramOutboundEnabled) {
  console.log(JSON.stringify({ event: 'webinarstars_followup_skipped', reason: 'outbound_or_followup_disabled' }));
} else {
  const store = new PostgresStore({ connectionString: config.databaseUrl, poolOptions: config.databasePoolOptions });
  try {
    const identity = await getTelegramBotIdentity({ fetchImpl: fetch, baseUrl: config.botApiBaseUrl, botToken: config.botToken, timeoutMs: config.timeoutMs });
    if (identity.username !== config.expectedBotUsername) throw new Error('Production bot identity mismatch');
    const transport = guardTelegramOutbound(createTelegramBotApiTransport({ fetchImpl: fetch, baseUrl: config.botApiBaseUrl,
      botToken: config.botToken, timeoutMs: config.timeoutMs }), { enabled: true, allowedTelegramUserId: config.allowedTelegramUserId });
    const scheduler = createWebinarStarsFollowUpScheduler({
      store, config: config.webinarStars,
      experienceProvider: createWebinarStarsExperienceProvider({ store, config: config.webinarStars }),
      applicationUrlProvider: createMenApplicationUrlProvider({ signingSecret: config.signingSecret,
        applicationReference: `${config.publicApplicationOrigin}/application` }),
      transport, templates: APPROVED_WEBINARSTARS_FOLLOW_UP_TEMPLATES,
      allowedUserId: config.allowedTelegramUserId,
      logger: { info: (entry) => console.log(JSON.stringify(entry)) },
    });
    console.log(JSON.stringify({ event: 'webinarstars_followup_summary', ...await scheduler.run() }));
  } finally { await store.close(); }
}
