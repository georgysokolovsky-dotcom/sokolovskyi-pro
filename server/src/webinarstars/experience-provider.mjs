import { buildWebinarStarsUrl, createCorrelationHmac, createCorrelationToken, WEBINARSTARS_CORRELATION_CONTRACT } from './correlation.mjs';
import { resolveDailyWebinarStarsSession } from './daily-session.mjs';

export function createInternalExperienceProvider() {
  return Object.freeze({
    name: 'internal',
    async createExperienceUrl({ internalUrl }) { return { url: internalUrl, provider: 'internal' }; },
  });
}

export function createWebinarStarsExperienceProvider({ store, config, includeMenRef = false, now = () => new Date() } = {}) {
  if (!store || !config) throw new Error('WebinarStars experience provider dependencies are required');
  return Object.freeze({
    name: 'webinarstars',
    async createExperienceUrl({ user, nextSession = false }) {
      const existingBinding = nextSession ? null : await store.findProviderSessionEntryForFunnelEntry(user.id);
      const schedule = config.scheduleMode === 'daily'
        ? resolveDailyWebinarStarsSession(now(), { timeZone: config.timeZone, localStart: config.dailyStartLocal, durationMinutes: config.durationMinutes })
        : { scheduledStart: config.scheduledStart, scheduledEnd: config.scheduledEnd };
      const token = createCorrelationToken(user.id, config.correlationSecret);
      const correlationHmac = createCorrelationHmac(token, config.correlationSecret);
      await store.ensureProviderCorrelation({
        correlationHmac, provider: 'webinarstars', funnelEntryId: user.id,
        userId: user.id, funnelId: user.funnelId, contractVersion: WEBINARSTARS_CORRELATION_CONTRACT,
      });
      const session = existingBinding ? await store.getProviderSyncSession(existingBinding.sessionId) : await store.ensureProviderSyncSession({
        provider: 'webinarstars', funnelId: user.funnelId, webinarId: config.webinarId,
        scheduledStart: schedule.scheduledStart, scheduledEnd: schedule.scheduledEnd,
        funnelVersion: WEBINARSTARS_CORRELATION_CONTRACT,
        firstPollAt: new Date(new Date(schedule.scheduledEnd).getTime() + config.pollOffsetsMinutes[0] * 60_000).toISOString(),
      });
      if (!session) throw new Error('provider_session_binding_missing');
      await store.ensureProviderSessionEntry({ sessionId: session.id, funnelEntryId: user.id, userId: user.id,
        funnelId: user.funnelId, correlationHmac });
      return { url: buildWebinarStarsUrl(config.registrationUrl, token, { includeMenRef }), provider: 'webinarstars' };
    },
  });
}
