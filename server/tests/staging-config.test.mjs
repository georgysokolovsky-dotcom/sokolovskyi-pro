import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { deleteTelegramWebhook, getTelegramBotIdentity, getTelegramWebhookStatus, setTelegramWebhook } from '../src/telegram/bot-api-admin.mjs';
import { createApp } from '../src/http/app.mjs';

const secrets = {
  TOKEN_SIGNING_SECRET: 'test-signing',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  ADMIN_SESSION_SECRET: 'test-admin',
};

test('local runtime keeps memory and dev transport as safe defaults', () => {
  const config = loadRuntimeConfig(secrets);
  assert.equal(config.mode, 'local');
  assert.equal(config.storeMode, 'memory');
  assert.equal(config.telegramTransportMode, 'dev');
  assert.equal(config.webinarMediaProvider, 'local');
  assert.equal(config.host, '127.0.0.1');
});

test('Mux media is opt-in and fails closed without all signing inputs', () => {
  assert.throws(() => loadRuntimeConfig({ ...secrets, WEBINAR_MEDIA_PROVIDER: 'mux' }), /MUX_SIGNING_KEY_ID/);
  const config = loadRuntimeConfig({
    ...secrets,
    WEBINAR_MEDIA_PROVIDER: 'mux',
    MUX_SIGNING_KEY_ID: 'key-id',
    MUX_SIGNING_PRIVATE_KEY: 'private-key-placeholder',
    MUX_PLAYBACK_ID: 'Playback123',
    MUX_PLAYBACK_TOKEN_TTL_SECONDS: '7200',
    MUX_PLAYBACK_BUFFER_SECONDS: '900',
  });
  assert.equal(config.webinarMediaProvider, 'mux');
  assert.equal(config.muxPlaybackTokenTtlSeconds, 7200);
  assert.equal(config.muxPlaybackBufferSeconds, 900);
  assert.throws(() => loadRuntimeConfig({ ...secrets, WEBINAR_MEDIA_PROVIDER: 'external' }), /local or mux/);
});

test('staging fails closed unless PostgreSQL, official Bot API and HTTPS URLs are explicit', () => {
  assert.throws(() => loadRuntimeConfig({ ...secrets, FUNNEL_MODE: 'staging' }), /FUNNEL_STORE=postgres/);
  const base = {
    ...secrets,
    FUNNEL_MODE: 'staging',
    FUNNEL_STORE: 'postgres',
    TELEGRAM_TRANSPORT: 'bot-api',
    DATABASE_URL: 'postgresql://staging.invalid/test',
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_BOT_API_BASE_URL: 'https://api.telegram.org',
    TELEGRAM_WEBHOOK_URL: 'https://staging.invalid/v1/webhooks/telegram',
    TELEGRAM_EXPECTED_BOT_USERNAME: '@men_staging_bot',
    WEBINAR_BASE_URL: 'https://staging.invalid/webinar',
  };
  const config = loadRuntimeConfig(base);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.expectedBotUsername, 'men_staging_bot');
  assert.throws(() => loadRuntimeConfig({ ...base, TELEGRAM_BOT_API_BASE_URL: 'https://telegram-proxy.invalid' }), /official/);
  assert.throws(() => loadRuntimeConfig({ ...base, TELEGRAM_WEBHOOK_URL: 'http://staging.invalid/v1/webhooks/telegram' }), /HTTPS/);
  assert.throws(() => loadRuntimeConfig({ ...base, TELEGRAM_WEBHOOK_URL: 'https://staging.invalid/wrong' }), /must end/);
  assert.throws(() => loadRuntimeConfig({ ...base, TELEGRAM_WEBHOOK_URL: 'https://staging.invalid/v1/webhooks/telegram?secret=bad' }), /must not contain/);
});

test('Telegram webhook admin calls are normalized and do not expose secrets', async (t) => {
  const requests = [];
  const webhookUrl = 'https://staging.invalid/v1/webhooks/telegram';
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ url: request.url, body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null });
    const method = request.url.split('/').at(-1);
    const result = method === 'getMe'
      ? { id: 42, username: 'men_staging_bot' }
      : method === 'getWebhookInfo'
        ? { url: webhookUrl, pending_update_count: 0, has_custom_certificate: false }
        : true;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const api = { fetchImpl: fetch, baseUrl: `http://127.0.0.1:${server.address().port}`, botToken: 'private-test-token', timeoutMs: 1000 };

  const identity = await getTelegramBotIdentity(api);
  await setTelegramWebhook(api, { webhookUrl, webhookSecret: 'private-webhook-secret', dropPendingUpdates: true });
  const status = await getTelegramWebhookStatus(api, { expectedUrl: webhookUrl });
  await deleteTelegramWebhook(api, { dropPendingUpdates: true });
  assert.deepEqual(identity, { id: '42', username: 'men_staging_bot' });
  assert.equal(status.configured, true);
  assert.equal(requests[1].body.secret_token, 'private-webhook-secret');
  assert.equal(requests[1].body.drop_pending_updates, true);
  assert.deepEqual(requests[1].body.allowed_updates, ['message']);
  assert.equal(requests[3].body.drop_pending_updates, true);
});

test('staging HTTP mode does not expose the local synthetic start endpoint', async (t) => {
  const app = createApp({ flow: {}, mode: 'staging', webhookSecret: 'secret', adminKey: 'admin' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${app.address().port}/v1/test/telegram/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
