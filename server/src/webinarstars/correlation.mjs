import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBINARSTARS_CORRELATION_CONTRACT = 'webinarstars-utm-content-v1';

function digest(secret, value) {
  if (typeof secret !== 'string' || !secret) throw new Error('WebinarStars correlation secret is required');
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function createCorrelationToken(funnelEntryId, secret) {
  if (typeof funnelEntryId !== 'string' || !funnelEntryId) throw new Error('funnelEntryId is required');
  return digest(secret, `token:${WEBINARSTARS_CORRELATION_CONTRACT}:${funnelEntryId}`).slice(0, 16);
}

export function createCorrelationHmac(token, secret) {
  if (!/^[a-z0-9]{16}$/.test(token)) throw new Error('Invalid WebinarStars correlation token');
  return digest(secret, `lookup:${WEBINARSTARS_CORRELATION_CONTRACT}:${token}`);
}

export function correlationHmacMatches(token, expectedHmac, secret) {
  const actual = Buffer.from(createCorrelationHmac(token, secret), 'hex');
  const expected = Buffer.from(String(expectedHmac), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildWebinarStarsUrl(registrationUrl, token, { includeMenRef = false } = {}) {
  const url = new URL(registrationUrl);
  url.searchParams.set('utm_source', 'telegram');
  url.searchParams.set('utm_medium', 'bot');
  url.searchParams.set('utm_campaign', 'men_webinar_v1');
  url.searchParams.set('utm_content', token);
  if (includeMenRef) url.searchParams.set('men_ref', token);
  return url.toString();
}

export function parseCorrelationToken(rawUtm) {
  if (typeof rawUtm !== 'string' || rawUtm.length > 4096) return null;
  const query = rawUtm.includes('?') ? rawUtm.slice(rawUtm.indexOf('?') + 1) : rawUtm.replace(/^\?/, '');
  const token = new URLSearchParams(query).get('utm_content');
  return token && /^[a-z0-9]{16}$/.test(token) ? token : null;
}
