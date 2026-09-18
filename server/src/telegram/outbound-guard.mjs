export function guardTelegramOutbound(transport, { enabled = true, allowedTelegramUserId = null } = {}) {
  return Object.freeze({
    provider: transport.provider,
    async sendMessage(payload) {
      if (!enabled) throw new Error('telegram_outbound_disabled');
      if (allowedTelegramUserId != null && String(payload.telegramChatId) !== String(allowedTelegramUserId)) {
        throw new Error('telegram_user_not_allowed');
      }
      return transport.sendMessage(payload);
    },
  });
}
