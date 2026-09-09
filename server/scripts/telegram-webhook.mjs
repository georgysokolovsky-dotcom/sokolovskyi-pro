import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { deleteTelegramWebhook, getTelegramBotIdentity, getTelegramWebhookStatus, setTelegramWebhook } from '../src/telegram/bot-api-admin.mjs';

const action = process.argv[2] ?? 'check';
if (!['check', 'set', 'delete'].includes(action)) throw new Error('Usage: npm run staging:webhook -- check|set|delete');
const dropPendingUpdates = process.argv.includes('--drop-pending');
if (dropPendingUpdates && !['set', 'delete'].includes(action)) throw new Error('--drop-pending is only valid with set or delete');

const config = loadRuntimeConfig();
if (config.mode !== 'staging') throw new Error('FUNNEL_MODE=staging is required');
const api = {
  fetchImpl: globalThis.fetch,
  baseUrl: config.botApiBaseUrl,
  botToken: config.botToken,
  timeoutMs: config.timeoutMs,
};

const identity = await getTelegramBotIdentity(api);
if (identity.username.toLowerCase() !== config.expectedBotUsername.toLowerCase()) {
  throw new Error('Telegram bot identity does not match TELEGRAM_EXPECTED_BOT_USERNAME');
}
if (action === 'set') {
  await setTelegramWebhook(api, { webhookUrl: config.webhookUrl, webhookSecret: config.webhookSecret, dropPendingUpdates });
} else if (action === 'delete') {
  await deleteTelegramWebhook(api, { dropPendingUpdates });
}
const status = await getTelegramWebhookStatus(api, { expectedUrl: config.webhookUrl });
if (action === 'delete' && status.configured) throw new Error('Telegram webhook is still configured');
if (action !== 'delete' && !status.configured) throw new Error('Telegram webhook is not configured for TELEGRAM_WEBHOOK_URL');

console.log(JSON.stringify({
  ok: true,
  action,
  droppedPendingUpdates: ['set', 'delete'].includes(action) ? dropPendingUpdates : false,
  botUsername: identity.username,
  webhookConfigured: status.configured,
  pendingUpdateCount: status.pendingUpdateCount,
  lastErrorDate: status.lastErrorDate,
  hasCustomCertificate: status.hasCustomCertificate,
}));
