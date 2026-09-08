export class TelegramTransportError extends Error {
  constructor(code, message = 'Telegram transport failed') {
    super(message);
    this.name = 'TelegramTransportError';
    this.code = code;
  }
}

/**
 * Dev-only adapter. The funnel flow depends on this small transport contract,
 * so a real Telegram Bot API adapter can be added later without changing the
 * domain logic.
 */
export function createDevTelegramTransport({ sendBonus } = {}) {
  return Object.freeze({
    async sendBonus(payload) {
      const result = typeof sendBonus === 'function'
        ? await sendBonus(payload)
        : { ok: true, messageId: `dev-bonus-${payload.userId}-${payload.bonus.id}` };

      if (result?.ok === false) {
        throw new TelegramTransportError(result.errorCode ?? 'transport_rejected');
      }

      return {
        ok: true,
        provider: result?.provider ?? 'dev',
        messageId: result?.messageId ?? `dev-bonus-${payload.userId}-${payload.bonus.id}`,
      };
    },
  });
}
