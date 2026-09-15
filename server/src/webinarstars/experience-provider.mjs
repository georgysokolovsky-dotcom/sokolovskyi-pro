import { buildWebinarStarsUrl, createCorrelationHmac, createCorrelationToken, WEBINARSTARS_CORRELATION_CONTRACT } from './correlation.mjs';

export function createInternalExperienceProvider() {
  return Object.freeze({
    name: 'internal',
    async createExperienceUrl({ internalUrl }) { return { url: internalUrl, provider: 'internal' }; },
  });
}

export function createWebinarStarsExperienceProvider({ store, config, includeMenRef = false } = {}) {
  if (!store || !config) throw new Error('WebinarStars experience provider dependencies are required');
  return Object.freeze({
    name: 'webinarstars',
    async createExperienceUrl({ user }) {
      const token = createCorrelationToken(user.id, config.correlationSecret);
      const correlationHmac = createCorrelationHmac(token, config.correlationSecret);
      await store.ensureProviderCorrelation({
        correlationHmac, provider: 'webinarstars', funnelEntryId: user.id,
        userId: user.id, funnelId: user.funnelId, contractVersion: WEBINARSTARS_CORRELATION_CONTRACT,
      });
      const session = await store.ensureProviderSyncSession({
        provider: 'webinarstars', funnelId: user.funnelId, webinarId: config.webinarId,
        scheduledStart: config.scheduledStart, scheduledEnd: config.scheduledEnd,
        funnelVersion: WEBINARSTARS_CORRELATION_CONTRACT,
        firstPollAt: new Date(new Date(config.scheduledEnd).getTime() + config.pollOffsetsMinutes[0] * 60_000).toISOString(),
      });
      await store.ensureProviderSessionEntry({ sessionId: session.id, funnelEntryId: user.id, userId: user.id,
        funnelId: user.funnelId, correlationHmac });
      return { url: buildWebinarStarsUrl(config.registrationUrl, token, { includeMenRef }), provider: 'webinarstars' };
    },
  });
}
