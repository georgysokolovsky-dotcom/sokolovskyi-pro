export function guardTelegramOutbound(transport, { enabled = true, allowedTelegramUserId = null } = {}) {
  return Object.freeze({
    provider: transport.provider,
    async sendMessage(payload) {
      if (!enabled) throw new Error('telegram_outbound_disabled');
      const recipientTelegramUserId = payload.telegramUserId ?? payload.telegramChatId;
      if (allowedTelegramUserId != null && String(recipientTelegramUserId) !== String(allowedTelegramUserId)) {
        throw new Error('telegram_user_not_allowed');
      }
      return transport.sendMessage(payload);
    },
  });
}
