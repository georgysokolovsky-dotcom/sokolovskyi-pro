import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { approvedArticles } from '../src/articleData.js';

const origin = 'https://sokolovskyi.pro';
const outputDirectory = new URL('../migration/baseline/', import.meta.url);

const routeMeta = {
  '/': { title: 'PRO Мужчин — когда отношения рушатся, важно не потерять себя', description: 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.', h1: 'Когда отношения рушатся, важно не потерять себя' },
  '/about/': { title: 'Об авторе — PRO Мужчин', description: 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.', h1: 'Георгий Соколовский — ментор для мужчин' },
  '/method/': { title: 'Подход к работе — PRO Мужчин', description: 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.', h1: 'Подход к работе' },
  '/webinar/': { title: 'Бесплатный вебинар — PRO Мужчин', description: 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.', h1: '3 шага как стать мужчиной, с которым считаются, ценят и боятся потерять' },
  '/articles/': { title: 'Все статьи — PRO Мужчин', description: 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.', h1: 'Все статьи' },
  '/topics/': { title: 'Темы — PRO Мужчин', description: 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.', h1: 'Темы' },
  '/topics/izmena-zheny/': { title: 'Измена жены — PRO Мужчин', description: 'Что делать после предательства, как разговаривать и принимать решения.', h1: 'Измена жены' },
  '/topics/razvod/': { title: 'Развод и расставание — PRO Мужчин', description: 'Как пройти перемены без саморазрушения и сохранить контакт с детьми.', h1: 'Развод и расставание' },
  '/topics/vozvrashchenie/': { title: 'Возвращение женщины — PRO Мужчин', description: 'О том, что зависит от твоих решений, а что нельзя контролировать.', h1: 'Возвращение женщины' },
  '/topics/revnost/': { title: 'Ревность, подозрения и контроль — PRO Мужчин', description: 'Как перестать жить в проверках и разговаривать о доверии.', h1: 'Ревность, подозрения и контроль' },
  '/topics/deti-posle-razvoda/': { title: 'Дети после развода — PRO Мужчин', description: 'Как оставаться отцом и принимать решения в интересах ребёнка.', h1: 'Дети после развода' },
  '/contacts/': { title: 'Контакты — PRO Мужчин', description: 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.', h1: 'Контакты' },
};

const sitemapRoutes = [
  '/', '/about/', '/method/', '/webinar/', '/articles/', '/topics/',
  '/topics/izmena-zheny/', '/topics/razvod/', '/topics/vozvrashchenie/', '/topics/revnost/',
  '/topics/deti-posle-razvoda/', '/contacts/',
  ...Object.values(approvedArticles).map((article) => `/articles/${article.slug}/`),
];

const specialRoutes = [
  { path: '/go/webinar', note: 'SPA-only redirect route; direct HTTP request was 404 at baseline.' },
  { path: '/cases/', note: 'Empty cases template; direct HTTP request was 404 at baseline.' },
  { path: '/editorial-policy/', note: 'Legal placeholder; direct HTTP request was 404 at baseline.' },
  { path: '/privacy-policy/', note: 'Legal placeholder; direct HTTP request was 404 at baseline.' },
  { path: '/cookie-policy/', note: 'Legal placeholder; direct HTTP request was 404 at baseline.' },
  { path: '/personal-data-consent/', note: 'Legal placeholder; direct HTTP request was 404 at baseline.' },
  { path: '/information-boundaries/', note: 'Legal placeholder; direct HTTP request was 404 at baseline.' },
  { path: '/topics/obescenivanie/', note: 'Empty topic; not present in sitemap.' },
  { path: '/topics/uverennost/', note: 'Empty topic; not present in sitemap.' },
  { path: '/definitely-missing-check/', note: 'Unknown route control sample.' },
];

const editorialSearchIntent = {
  article_0001: 'informational', article_0002: 'informational', article_0003: 'informational',
  article_0004: 'decision support', article_0005: 'informational', article_0006: 'informational',
  article_0007: 'informational', article_0008: 'informational', article_0009: 'informational',
  article_0010: 'informational', article_0011: 'decision support', article_0012: 'decision support',
  article_0013: 'decision support', article_0014: 'informational', article_0015: 'informational',
};

const blockText = (block) => [
  block.title,
  block.text,
  ...(block.paragraphs || []),
  ...(block.bullets || []),
  ...(block.steps || []).flat(),
].filter(Boolean).join('\n');

const contentText = (article) => [
  article.title,
  article.description,
  article.intro,
  article.asideNote,
  ...(article.summary || []).flat(),
  ...(article.blocks || []).map(blockText),
].filter(Boolean).join('\n');

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const readStatus = async (path) => {
  try {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
    return { status: response.status, statusText: response.statusText };
  } catch (error) {
    return { status: null, statusText: 'fetch-error', error: error.message };
  }
};

const articleEntries = Object.values(approvedArticles).map((article) => {
  const text = contentText(article);
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    description: article.description,
    topic: article.topic,
    category: article.category,
    updatedAt: article.updatedAt,
    readingTime: article.readingTime,
    summary: article.summary,
    related: article.related,
    contentText: text,
    contentSha256: sha256(text),
    original: article,
  };
});

const mainRoutes = [];
for (const path of sitemapRoutes) {
  const articleSlug = path.match(/^\/articles\/([^/]+)\/$/)?.[1];
  const article = articleSlug ? approvedArticles[articleSlug] : null;
  const meta = article
    ? { title: `${article.title} — PRO Мужчин`, description: article.description, h1: article.title }
    : routeMeta[path];
  const { status, statusText, error } = await readStatus(path);
  mainRoutes.push({
    url: path,
    absoluteUrl: `${origin}${path}`,
    httpStatus: status,
    httpStatusText: statusText,
    ...(error ? { fetchError: error } : {}),
    title: meta?.title ?? null,
    description: meta?.description ?? null,
    canonical: `${origin}${path}`,
    h1: meta?.h1 ?? null,
    ...(article ? { articleSlug: article.slug } : {}),
    source: 'live-rendered DOM and current source metadata',
  });
}

const specialRouteEntries = [];
for (const { path, note } of specialRoutes) {
  const { status, statusText, error } = await readStatus(path);
  specialRouteEntries.push({
    url: path,
    absoluteUrl: `${origin}${path}`,
    httpStatus: status,
    httpStatusText: statusText,
    ...(error ? { fetchError: error } : {}),
    title: null,
    description: null,
    canonical: null,
    h1: null,
    note,
    source: 'direct HTTP baseline',
  });
}

const runtimeManifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  cta: {
    targetRoute: '/go/webinar',
    targetOrigin: 'https://gipnogeorge.com/web/neuromagic/devaluation_man',
    placementsObserved: ['hero', 'inline', 'footer', 'header', 'webinar', 'contacts', 'skeleton'],
    utm: {
      utm_source: 'seo',
      utm_medium: 'article',
      utm_campaign: 'mens_webinar',
      utm_content: 'article id',
      article_id: 'article id',
      topic: 'article topic',
      placement: 'CTA placement',
    },
    note: 'The runtime query whitelist and builder remain in src/main.jsx until later migration stages.',
  },
  articles: articleEntries.map(({ id, slug, topic, category, related, summary }) => ({
    id, slug, topic, category, searchIntent: editorialSearchIntent[id] || null, related, summary,
    socialImage: `/images/social/${id}-social.svg`,
  })),
};

const capturedAt = new Date().toISOString();
const baseline = {
  schemaVersion: 1,
  capturedAt,
  origin,
  sourceCommit: '7daab3a',
  routeCounts: { sitemapRoutes: sitemapRoutes.length, specialRoutes: specialRoutes.length },
  routes: [...mainRoutes, ...specialRouteEntries],
  articleUrls: articleEntries.map((article) => `${origin}/articles/${article.slug}/`),
  notes: [
    'The live SPA supplies rendered H1 values after JavaScript hydration.',
    'The current hydrated non-article descriptions are generic because RouteMeta overwrites route-specific static descriptions.',
    'The baseline is evidence only; it is not a source of truth for future content changes.',
  ],
};
runtimeManifest.capturedAt = capturedAt;

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('route-manifest.json', outputDirectory), `${JSON.stringify(baseline, null, 2)}\n`);
await writeFile(new URL('articles-content.json', outputDirectory), `${JSON.stringify({ schemaVersion: 1, capturedAt, articles: articleEntries }, null, 2)}\n`);
await writeFile(new URL('article-runtime-manifest.json', outputDirectory), `${JSON.stringify(runtimeManifest, null, 2)}\n`);
console.log(`Baseline written: ${mainRoutes.length} sitemap routes, ${specialRouteEntries.length} special routes, ${articleEntries.length} articles.`);
