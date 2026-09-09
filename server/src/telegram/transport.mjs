export class TelegramTransportError extends Error {
  constructor(code, message = 'Telegram transport failed', status = null) {
    super(message);
    this.name = 'TelegramTransportError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Dev-only adapter. The funnel flow depends on the same small transport
 * contract as the Bot API-compatible adapter, while staying fully offline.
 */
export function createDevTelegramTransport({ sendMessage, sendBonus } = {}) {
  const transport = {
    provider: 'dev',
    async sendMessage(payload) {
      const callback = typeof sendMessage === 'function'
        ? sendMessage
        : payload.message?.role === 'bonus' && typeof sendBonus === 'function'
          ? sendBonus
          : null;
      const result = callback
        ? await callback(payload)
        : { ok: true, messageId: `dev-${payload.message?.role ?? 'message'}-${payload.userId}` };

      if (result?.ok === false) {
        throw new TelegramTransportError(result.errorCode ?? 'transport_rejected');
      }

      return {
        ok: true,
        provider: result?.provider ?? 'dev',
        messageId: String(result?.messageId ?? `dev-${payload.message?.role ?? 'message'}-${payload.userId}`),
      };
    },
  };
  transport.sendBonus = (payload) => transport.sendMessage({
    ...payload,
    message: { ...payload.message, role: payload.message?.role ?? 'bonus' },
  });
  return Object.freeze(transport);
}
