import test from 'node:test';
import assert from 'node:assert/strict';
import { safeToken, allowedParams, visitParams, webinarHref, updateAttributionLinks } from '../../src/lib/attribution.js';
import { pageContext } from '../../src/lib/page-context.js';
import { readingMinutes, relatedEntries, summaryItems } from '../../src/lib/content-presentation.js';
import { articleSocialImage } from '../../src/lib/seo.js';
import { sortArticles, publishedArticles } from '../../src/lib/articles.js';
import { analytics } from '../../src/data/analytics.js';
import { readConsent, createAnalyticsController, cleanPageLocation } from '../../src/lib/analytics.js';

const entry = (slug, status = 'published', date = '2026-01-01') => ({ data: { slug, status, datePublished: null, dateModified: date } });
test('incoming paid/Telegram campaign is preserved separately from article and placement', () => {
  const url = 'https://sokolovskyi.pro/articles/example/?utm_source=telegram&utm_medium=post&utm_campaign=autumn&utm_content=post_4&utm_term=men';
  const visit = visitParams(url);
  const href = new URL(webinarHref('/go/webinar/', { article_id: 'article_0001', topic: 'izmena', placement: 'header_mobile', page_id: 'example', page_type: 'article' }, visit), url);
  assert.equal(href.searchParams.get('utm_source'), 'telegram');
  assert.equal(href.searchParams.get('utm_content'), 'post_4');
  assert.equal(href.searchParams.get('article_id'), 'article_0001');
  assert.equal(href.searchParams.get('placement'), 'header_mobile');
});
test('partial UTM does not acquire invented SEO attributes', () => {
  assert.deepEqual(visitParams('https://sokolovskyi.pro/?utm_source=ad'), { utm_source: 'ad' });
});
test('unmarked direct, search and referral visits have explicit source rules', () => {
  assert.equal(visitParams('https://sokolovskyi.pro/').utm_source, 'direct');
  assert.deepEqual(visitParams('https://sokolovskyi.pro/', 'https://www.google.es/search?q=private'), { utm_source: 'google', utm_medium: 'organic' });
  assert.deepEqual(visitParams('https://sokolovskyi.pro/', 'https://example.com/private'), { utm_source: 'referral', utm_medium: 'referral' });
});
test('allowlist rejects contact data, long values, unknown params and URL payloads', () => {
  assert.deepEqual(allowedParams(new URLSearchParams({ email: 'person@example.com', utm_source: 'person@example.com', utm_content: '34-612-345-678', utm_medium: 'https://evil.com', topic: 'izmena', utm_term: 'a'.repeat(81) })), { topic: 'izmena' });
});
test('phone-like labels cannot bypass the filter with separators', () => {
  for (const token of ['34-612-345-678', '612.345.678', '612_345_678', '612345678']) assert.equal(safeToken(token), null);
  assert.equal(safeToken('post_26'), 'post_26');
});
test('internal navigation carries only campaign params; hash-only and external links stay intact', () => {
  const links = ['/about/', '#section', 'https://other.example/'];
  const nodes = links.map((href) => ({ value: href, getAttribute() { return this.value; }, setAttribute(_, v) { this.value = v; } }));
  updateAttributionLinks({ querySelectorAll: () => nodes }, 'https://sokolovskyi.pro/?utm_source=telegram&email=private');
  assert.equal(nodes[0].value, '/about/?utm_source=telegram');
  assert.equal(nodes[1].value, '#section');
  assert.equal(nodes[2].value, links[2]);
});
test('article and topic contexts differ from the home page', () => {
  assert.deepEqual(pageContext('/articles/real-slug/', { article_id: 'article_0007', topic: 'izmena' }), { page_id: 'real-slug', page_type: 'article', article_id: 'article_0007', topic: 'izmena' });
  assert.equal(pageContext('/topics/izmena-zheny/').topic, 'izmena');
  assert.equal(pageContext('/contacts/').page_id, 'contacts');
});
test('related draft and missing entries are safely omitted', () => {
  const entries = [entry('public'), entry('draft', 'draft')];
  assert.deepEqual(relatedEntries(publishedArticles(entries), ['draft', 'public', 'missing']).map((x) => x.data.slug), ['public']);
});
test('new publications precede the old fixed card list, with deterministic ties', () => {
  const records = [entry('kak-perezhit-izmenu-zheny'), entry('brand-new', 'published', '2026-10-27')];
  assert.equal(sortArticles(records)[0].data.slug, 'brand-new');
});
test('reading time uses body words and ignores markup and table of contents', () => {
  assert.equal(readingMinutes('слово '.repeat(361)), 3);
  assert.equal(readingMinutes('- [Оглавление](#section)\n<a id="section"></a>\n' + 'слово '.repeat(180)), 1);
});
test('empty headings hide table of contents; authored list is not duplicated', () => {
  assert.deepEqual(summaryItems('', []), { items: [], showGenerated: false });
  assert.equal(summaryItems('- [Раздел](#first)', []).showGenerated, false);
  assert.deepEqual(summaryItems('', [{ depth: 2, text: 'Раздел', slug: 'first' }]).items, [{ label: 'Раздел', id: 'first' }]);
});
test('missing social image or article ID uses an existing PNG fallback', () => {
  for (const article of [{ data: {} }, { data: { article_id: 'missing' } }, { data: { article_id: '../private' } }]) assert.equal(articleSocialImage(article), 'https://sokolovskyi.pro/images/georgiy-portrait.png');
  assert.match(articleSocialImage({ data: { article_id: 'article_0001' } }), /article_0001-social.svg$/);
});

function fixture({ saved, storageFails = false, enabled = true } = {}) {
  let value = saved ? JSON.stringify(saved) : null;
  const storage = { getItem: () => value, removeItem: () => { value = null; }, setItem(_, next) { if (storageFails) throw Error('blocked'); value = next; } };
  const scripts = [];
  const win = { localStorage: storage, location: new URL('https://sokolovskyi.pro/articles/test/?utm_source=telegram&utm_medium=post&email=private@example.com#private'), dataLayer: [] };
  const doc = { body: { dataset: { articleId: 'article_0001', topic: 'izmena', pageId: 'test', pageType: 'article', pagePath: '/articles/test/' } }, referrer: 'https://referrer.example/?secret=private', cookie: '_ga=test; _ga_ABC=test', head: { append: (script) => scripts.push(script) }, createElement: () => ({}) };
  const controller = createAnalyticsController(win, doc, { enabled });
  const events = (name) => win.dataLayer.map((args) => [...args]).filter((args) => args[0] === 'event' && args[1] === name);
  return { win, doc, storage, scripts, controller, events };
}
test('before choice and after refusal no tag loads and no page/CTA events are emitted', () => {
  for (const saved of [undefined, { choice: 'denied', savedAt: Date.now() }]) {
    const f = fixture({ saved }); f.controller.start(); f.controller.cta({ dataset: {} });
    assert.equal(f.scripts.length, 0); assert.equal(f.win.dataLayer.length, 0);
  }
});
test('grant loads once and emits one page view even on repeated initialization/consent', () => {
  const f = fixture(); f.controller.choose('granted'); f.controller.start(); f.controller.choose('granted');
  assert.equal(f.scripts.length, 1); assert.equal(f.events('page_view').length, 1);
  const config = f.win.dataLayer.map((x) => [...x]).find((x) => x[0] === 'config');
  assert.equal(config[2].send_page_view, false);
  assert.equal(f.events('page_view')[0][2].article_id, 'article_0001');
});
test('each document reload has exactly one page view with saved consent', () => {
  for (let i = 0; i < 2; i++) { const f = fixture({ saved: { choice: 'granted', savedAt: Date.now() } }); f.controller.start(); f.controller.start(); assert.equal(f.events('page_view').length, 1); }
});
test('one CTA action emits one event with article, placement and original campaign', () => {
  const f = fixture(); f.controller.choose('granted');
  f.controller.cta({ dataset: { articleId: 'article_0001', topic: 'izmena', placement: 'header_mobile' } });
  const events = f.events('webinar_click'); assert.equal(events.length, 1);
  assert.equal(events[0][2].placement, 'header_mobile'); assert.equal(events[0][2].utm_source, 'telegram');
  assert.equal(events[0][2].page_location.includes('private'), false);
  assert.equal(events[0][2].page_referrer, '');
});
test('withdrawal blocks subsequent events and disables GA', () => {
  const f = fixture(); f.controller.choose('granted'); f.controller.choose('denied');
  f.controller.cta({ dataset: { placement: 'header' } }); f.controller.start();
  assert.equal(f.events('webinar_click').length, 0);
  assert.equal(f.win[`ga-disable-${analytics.measurementId}`], true);
});
test('expired, future and corrupt consent remain off', () => {
  const f = fixture({ saved: { choice: 'granted', savedAt: 0 } }); f.controller.start(); assert.equal(f.scripts.length, 0);
  assert.equal(readConsent({ getItem: () => '{broken', removeItem() {} }), null);
  assert.equal(readConsent({ getItem: () => JSON.stringify({ choice: 'granted', savedAt: Date.now() + 5000 }), removeItem() {} }), null);
});
test('blocked storage and local preview cannot enable analytics', () => {
  const f = fixture({ storageFails: true }); assert.equal(f.controller.choose('granted'), false); assert.equal(f.scripts.length, 0);
  const local = fixture({ enabled: false }); local.controller.choose('granted'); assert.equal(local.scripts.length, 0);
});
test('arbitrary URL query and hash never enter analytics location', () => {
  assert.equal(cleanPageLocation('https://sokolovskyi.pro/?email=private@example.com#private', { utm_source: 'telegram' }), 'https://sokolovskyi.pro/?utm_source=telegram');
});
