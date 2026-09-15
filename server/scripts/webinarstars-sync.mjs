import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { createWebinarStarsClient } from '../src/webinarstars/client.mjs';
import { createWebinarStarsSyncScheduler } from '../src/webinarstars/sync-scheduler.mjs';

const config = loadRuntimeConfig();
if (config.webinarExperienceProvider !== 'webinarstars' || !config.webinarStars) throw new Error('WEBINAR_EXPERIENCE_PROVIDER=webinarstars is required');
const store = new PostgresStore({ connectionString: config.databaseUrl });
try {
  const scheduler = createWebinarStarsSyncScheduler({
    store,
    client: createWebinarStarsClient({ baseUrl: config.webinarStars.apiBaseUrl, apiToken: config.webinarStars.apiToken, timeoutMs: config.timeoutMs }),
    config: config.webinarStars,
    logger: { info: (entry) => console.log(JSON.stringify(entry)) },
  });
  const retryIndex = process.argv.indexOf('--retry');
  if (retryIndex !== -1) {
    const sessionId = process.argv[retryIndex + 1];
    if (!/^[0-9a-f-]{36}$/i.test(sessionId ?? '')) throw new Error('--retry requires a provider sync session UUID');
    const retried = await scheduler.retrySession(sessionId);
    if (!retried) throw new Error('Provider sync session is not retryable');
  }
  console.log(JSON.stringify(await scheduler.run()));
} finally {
  await store.close();
}
