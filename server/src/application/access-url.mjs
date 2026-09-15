import { signFunnelToken } from '../security/signed-tokens.mjs';

export function createMenApplicationUrlProvider({
  signingSecret,
  applicationReference = 'lab://men-funnel/application',
  ttlSeconds = 60 * 60,
  now = () => new Date(),
} = {}) {
  if (!signingSecret || typeof applicationReference !== 'string' || !applicationReference.trim()) {
    throw new Error('MEN application URL provider configuration is required');
  }
  return Object.freeze({
    createApplicationUrl({ user }) {
      if (!user?.id || !user?.funnelId) throw new Error('MEN application URL user is required');
      const currentTime = now();
      const token = signFunnelToken({
        purpose: 'application', userRef: user.id, funnelId: user.funnelId,
        ttlSeconds, secret: signingSecret, now: () => currentTime.getTime(),
      });
      const separator = applicationReference.includes('?') ? '&' : '?';
      const issuedAt = Math.floor(currentTime.getTime() / 1000);
      return {
        token,
        purpose: 'application',
        expiresInSeconds: ttlSeconds,
        expiresAt: new Date((issuedAt + ttlSeconds) * 1000).toISOString(),
        url: `${applicationReference}${separator}t=${encodeURIComponent(token)}`,
      };
    },
  });
}
