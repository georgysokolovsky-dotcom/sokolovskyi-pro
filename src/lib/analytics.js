import { analytics } from '../data/analytics.js';
import { utmKeys, visitParams, safeToken, updateAttributionLinks } from './attribution.js';

export function readConsent(storage, now = Date.now()) {
  try {
    const saved = JSON.parse(storage.getItem(analytics.consentKey));
    if (!saved || !['granted', 'denied'].includes(saved.choice) || !Number.isFinite(saved.savedAt) || saved.savedAt > now || now - saved.savedAt >= analytics.consentTtlMs) {
      storage.removeItem(analytics.consentKey);
      return null;
    }
    return saved.choice;
  } catch { return null; }
}

export function cleanPageLocation(url, visit) {
  const page = new URL(url);
  page.search = '';
  page.hash = '';
  Object.entries(visit).filter(([key]) => utmKeys.includes(key)).forEach(([key, value]) => page.searchParams.set(key, value));
  return page.toString();
}

export function createAnalyticsController(win, doc, { measurementId = analytics.measurementId, enabled = true } = {}) {
  let storage;
  try { storage = win.localStorage; } catch { storage = null; }
  let choice = readConsent(storage);
  let configured = false;
  let pageTracked = false;
  const disableKey = `ga-disable-${measurementId}`;
  win[disableKey] = true;
  const canSend = () => enabled && /^G-[A-Z0-9]+$/.test(measurementId) && choice === 'granted' && readConsent(storage) === 'granted';
  const consent = (state) => ({ analytics_storage: state, ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  const gtag = (...args) => win.gtag?.(...args);
  const context = () => {
    const body = doc.body.dataset;
    const params = { page_id: body.pageId, page_type: body.pageType, article_id: body.articleId, topic: body.topic };
    return { ...Object.fromEntries(Object.entries(params).filter(([, value]) => safeToken(value))), category: safeToken(body.topic) || undefined };
  };
  const eventParams = () => {
    const visit = visitParams(win.location.href, doc.referrer);
    return { ...context(), ...visit, page_location: cleanPageLocation(`${win.location.origin}${doc.body.dataset.pagePath || '/'}`, visit), page_referrer: '' };
  };
  const pageView = () => {
    if (!canSend() || pageTracked) return;
    pageTracked = true;
    gtag('event', 'page_view', eventParams());
  };
  const activate = () => {
    if (!canSend()) return;
    win[disableKey] = false;
    if (!configured) {
      configured = true;
      win.dataLayer = win.dataLayer || [];
      win.gtag = win.gtag || function () { win.dataLayer.push(arguments); };
      gtag('consent', 'default', consent('denied'));
      gtag('consent', 'update', consent('granted'));
      gtag('js', new Date());
      gtag('config', measurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, ...eventParams() });
      const script = doc.createElement('script');
      script.id = 'site-google-analytics';
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
      doc.head.append(script);
    } else gtag('consent', 'update', consent('granted'));
    pageView();
  };
  const disable = () => {
    win[disableKey] = true;
    if (configured) gtag('consent', 'update', consent('denied'));
    // Clear GA cookies for the current host and its parent domains.
    const labels = win.location.hostname.split('.');
    const domains = ['', ...labels.map((_, index) => `.${labels.slice(index).join('.')}`)];
    for (const part of doc.cookie.split(';')) {
      const name = part.split('=')[0].trim();
      if (!/^_ga(?:_|$)/.test(name)) continue;
      for (const domain of domains) doc.cookie = `${name}=; Max-Age=0; path=/;${domain ? ` domain=${domain};` : ''}`;
    }
  };
  return {
    start: activate,
    get choice() { return choice; },
    choose(next) {
      if (!['granted', 'denied'].includes(next)) return false;
      try {
        storage.setItem(analytics.consentKey, JSON.stringify({ choice: next, savedAt: Date.now() }));
        choice = next;
      } catch { choice = null; disable(); return false; }
      if (next === 'granted') activate(); else disable();
      return true;
    },
    refreshConsent() {
      choice = readConsent(storage);
      if (choice === 'granted') activate(); else disable();
    },
    cta(link) {
      if (!canSend()) return;
      const data = link.dataset;
      gtag('event', 'webinar_click', {
        ...eventParams(),
        article_id: safeToken(data.articleId) || undefined,
        topic: safeToken(data.topic) || undefined,
        placement: safeToken(data.placement) || undefined,
        transport_type: 'beacon',
      });
    },
  };
}

export function initSiteClient(win = window, doc = document) {
  if (win.__proSiteClient) return win.__proSiteClient;
  updateAttributionLinks(doc, win.location.href, doc.referrer);
  const allowed = analytics.hosts.includes(win.location.hostname) && doc.body.dataset.analyticsEnabled === 'true';
  const controller = createAnalyticsController(win, doc, { enabled: allowed });
  win.__proSiteClient = controller;
  const panel = doc.querySelector('[data-consent-panel]');
  const show = () => { if (panel) panel.hidden = false; };
  const hide = () => { if (panel) panel.hidden = true; };
  if (!controller.choice) show();
  controller.start();
  win.addEventListener('open-cookie-settings', show);
  win.addEventListener('pageshow', () => controller.refreshConsent());
  win.addEventListener('focus', () => controller.refreshConsent());
  win.addEventListener('storage', (event) => { if (event.key === analytics.consentKey) { controller.refreshConsent(); if (!controller.choice) show(); } });
  doc.addEventListener('click', (event) => {
    const button = event.target.closest('[data-consent-choice], [data-open-cookie-settings]');
    if (button) {
      if (button.hasAttribute('data-open-cookie-settings')) show();
      else if (controller.choose(button.dataset.consentChoice)) hide();
      return;
    }
    const link = event.target.closest('a[data-webinar-cta]');
    if (link) controller.cta(link);
  });
  return controller;
}
