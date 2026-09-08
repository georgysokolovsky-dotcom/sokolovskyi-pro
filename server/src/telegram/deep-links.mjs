const usernamePattern = /^[a-zA-Z0-9_]{5,32}$/;
const startParameterPattern = /^[a-z0-9_-]{1,64}$/i;

export function normalizeBotUsername(value) {
  const username = String(value ?? '').trim().replace(/^@/, '');
  if (!usernamePattern.test(username)) throw new Error('Invalid Telegram bot username');
  return username;
}

export function buildTelegramDeepLink({ botUsername, startParameter }) {
  const username = normalizeBotUsername(botUsername);
  if (!startParameterPattern.test(startParameter ?? '')) throw new Error('Invalid Telegram start parameter');
  return `https://t.me/${username}?start=${encodeURIComponent(startParameter)}`;
}
