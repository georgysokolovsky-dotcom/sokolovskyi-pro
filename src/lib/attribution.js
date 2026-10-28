// Campaign labels are categorical tokens, never arbitrary URL content.
export const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
export const contextKeys = ['article_id', 'topic', 'placement', 'page_id', 'page_type'];
export const webinarParamKeys = [...utmKeys, ...contextKeys];
export const defaultVisit = { utm_source: 'direct', utm_medium: 'none', utm_campaign: 'mens_webinar' };
export const webinarPlacements = ['hero', 'inline', 'article_end', 'band', 'footer', 'header', 'header_mobile', 'webinar', 'contacts', 'skeleton'];

export function safeToken(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._~-]{0,79}$/i.test(value) || value.replace(/\D/g, '').length >= 7) return null;
  return value;
}

export function allowedParams(input, keys = webinarParamKeys) {
  const source = input instanceof URLSearchParams ? input : new URLSearchParams(input);
  return Object.fromEntries(keys.flatMap((key) => {
    const value = safeToken(source.get(key));
    if (!value || (key === 'placement' && !webinarPlacements.includes(value)) || (key === 'page_type' && !['article', 'topic', 'site'].includes(value))) return [];
    return [[key, value]];
  }));
}

export function visitParams(url, referrer = '') {
  const incoming = allowedParams(new URL(url).searchParams, utmKeys);
  // Any valid incoming campaign marks the visit; never mix it with an SEO default.
  if (Object.keys(incoming).length) return incoming;
  try {
    const ref = new URL(referrer);
    if (ref.origin !== new URL(url).origin) {
      const host = ref.hostname.toLowerCase().replace(/^www\./, '');
      if (/(^|\.)google\.[a-z.]+$/.test(host)) return { utm_source: 'google', utm_medium: 'organic' };
      if (host === 'bing.com') return { utm_source: 'bing', utm_medium: 'organic' };
      if (host === 't.me' || host === 'telegram.org') return { utm_source: 'telegram', utm_medium: 'referral' };
      // Do not forward arbitrary referrer hostnames or user-supplied URL data.
      return { utm_source: 'referral', utm_medium: 'referral' };
    }
  } catch { /* No usable referrer. */ }
  return { ...defaultVisit };
}

export function webinarHref(route, context, visit = defaultVisit) {
  const params = allowedParams(new URLSearchParams({ ...visit, ...context }));
  return `${route}?${new URLSearchParams(params)}`;
}

export function updateAttributionLinks(document, url, referrer = '') {
  const location = new URL(url);
  const visit = visitParams(url, referrer);
  for (const link of document.querySelectorAll('a[href]')) {
    const raw = link.getAttribute('href');
    if (!raw || raw.startsWith('#')) continue;
    const target = new URL(raw, location);
    if (target.origin !== location.origin || /\.[a-z0-9]+$/i.test(target.pathname)) continue;
    utmKeys.forEach((key) => target.searchParams.delete(key));
    Object.entries(visit).forEach(([key, value]) => target.searchParams.set(key, value));
    link.setAttribute('href', `${target.pathname}${target.search}${target.hash}`);
  }
  return visit;
}
