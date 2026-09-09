import { TelegramTransportError } from './transport.mjs';

function safeUrl(baseUrl, botToken, method) {
  return `${baseUrl.replace(/\/+$/, '')}/bot${botToken}/${method}`;
}

async function callTelegram({ fetchImpl, baseUrl, botToken, method, payload = null, timeoutMs = 5000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(safeUrl(baseUrl, botToken, method), {
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'content-type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') throw new TelegramTransportError('telegram_timeout');
      throw new TelegramTransportError('telegram_network_error');
    }
    if (!response.ok) throw new TelegramTransportError('telegram_http_error', 'Telegram request failed', response.status);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new TelegramTransportError('telegram_malformed_response');
    }
    if (!body || body.ok !== true || body.result == null) throw new TelegramTransportError('telegram_api_error');
    return body.result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getTelegramBotIdentity(config) {
  const result = await callTelegram({ ...config, method: 'getMe' });
  if (typeof result.username !== 'string' || !result.username) throw new TelegramTransportError('telegram_malformed_response');
  return { id: String(result.id), username: result.username };
}

export async function setTelegramWebhook(config, { webhookUrl, webhookSecret, dropPendingUpdates = false }) {
  await callTelegram({
    ...config,
    method: 'setWebhook',
    payload: {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
      drop_pending_updates: Boolean(dropPendingUpdates),
    },
  });
}

export async function deleteTelegramWebhook(config, { dropPendingUpdates = true } = {}) {
  await callTelegram({
    ...config,
    method: 'deleteWebhook',
    payload: { drop_pending_updates: Boolean(dropPendingUpdates) },
  });
}

export async function getTelegramWebhookStatus(config, { expectedUrl }) {
  const result = await callTelegram({ ...config, method: 'getWebhookInfo' });
  return {
    configured: result.url === expectedUrl,
    pendingUpdateCount: Number(result.pending_update_count ?? 0),
    lastErrorDate: result.last_error_date ? new Date(Number(result.last_error_date) * 1000).toISOString() : null,
    hasCustomCertificate: Boolean(result.has_custom_certificate),
  };
}
