import { TelegramTransportError } from './transport.mjs';

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function buildReplyMarkup(buttons = []) {
  const urlButtons = buttons
    .filter((button) => button?.type === 'url' && typeof button.url === 'string' && button.url)
    .map((button) => ({ text: button.label, url: button.url }));
  return urlButtons.length ? { inline_keyboard: [urlButtons] } : undefined;
}

export function createTelegramBotApiTransport({ fetchImpl, baseUrl, botToken, timeoutMs = 5000 }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const apiBaseUrl = requireNonEmptyString(baseUrl, 'baseUrl').replace(/\/+$/, '');
  const token = requireNonEmptyString(botToken, 'botToken');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive number');

  return Object.freeze({
    provider: 'telegram-bot-api',
    async sendMessage({ telegramChatId, message }) {
      if (telegramChatId == null) throw new TelegramTransportError('telegram_invalid_payload');
      if (!message || typeof message.text !== 'string' || !message.text.trim()) {
        throw new TelegramTransportError('telegram_invalid_payload');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        try {
          response = await fetchImpl(`${apiBaseUrl}/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChatId,
              text: message.text,
              reply_markup: buildReplyMarkup(message.buttons),
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') {
            throw new TelegramTransportError('telegram_timeout');
          }
          throw new TelegramTransportError('telegram_network_error');
        }

        if (!response || typeof response.ok !== 'boolean' || typeof response.status !== 'number') {
          throw new TelegramTransportError('telegram_malformed_response');
        }
        if (!response.ok) {
          throw new TelegramTransportError('telegram_http_error', 'Telegram transport failed', response.status);
        }

        let body;
        try {
          body = await response.json();
        } catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') {
            throw new TelegramTransportError('telegram_timeout');
          }
          throw new TelegramTransportError('telegram_malformed_response');
        }
        if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean') {
          throw new TelegramTransportError('telegram_malformed_response');
        }
        if (body.ok === false) throw new TelegramTransportError('telegram_api_error');
        if (body.result?.message_id == null) throw new TelegramTransportError('telegram_malformed_response');

        return {
          ok: true,
          provider: 'telegram-bot-api',
          messageId: String(body.result.message_id),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
