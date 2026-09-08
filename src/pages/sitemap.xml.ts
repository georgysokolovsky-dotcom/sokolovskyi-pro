import { getCollection } from 'astro:content';
import { site } from '../data/site.js';
import { topicList } from '../data/topics.js';
import { publishedArticles, sortArticles } from '../lib/articles.js';
import { validateArticleEntries } from '../lib/content-validation.js';
import { absoluteUrl, staticIndexableRoutes, articlePath } from '../lib/site-routes.js';

const xmlEscape = (value) => String(value).replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]);

export async function GET() {
  const entries = await getCollection('articles');
  validateArticleEntries(entries);
  const published = sortArticles(publishedArticles(entries));
  const populatedTopics = topicList.filter((topic) => published.some((entry) => entry.data.topic === topic.id));
  const urls = [
    ...staticIndexableRoutes.filter((path) => !path.startsWith('/editorial-policy') && !path.startsWith('/privacy-policy') && !path.startsWith('/cookie-policy') && !path.startsWith('/personal-data-consent') && !path.startsWith('/information-boundaries')),
    ...populatedTopics.map((topic) => `/topics/${topic.slug}/`),
    ...published.map((entry) => ({ path: articlePath(entry.data.slug), lastmod: entry.data.dateModified })),
  ];
  const body = urls.map((item) => {
    const path = typeof item === 'string' ? item : item.path;
    const lastmod = typeof item === 'string' ? '' : `<lastmod>${xmlEscape(item.lastmod.toISOString().slice(0, 10))}</lastmod>`;
    return `<url><loc>${xmlEscape(absoluteUrl(path))}</loc>${lastmod}</url>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

export const prerender = true;
