import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getTopicById } from '../src/data/topics.js';

const root = process.cwd();
const dist = join(root, 'dist');
const articlesDirectory = join(root, 'src/content/articles');
const origin = 'https://sokolovskyi.pro';
const errors = [];

async function filesIn(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await filesIn(path));
    else result.push(path);
  }
  return result;
}

function routeFromFile(file) {
  const path = relative(dist, file).replace(/\\/g, '/');
  if (path === 'index.html') return '/';
  if (path === '404.html') return '/404';
  return `/${path.replace(/index\.html$/, '')}`;
}

function normalizeRoute(path) {
  if (path === '/') return '/';
  return `${path.replace(/\/+$/, '')}/`;
}

function attribute(html, element, name, value) {
  const tags = html.match(new RegExp(`<${element}\\b[^>]*>`, 'gi')) ?? [];
  const requested = tags.find((tag) => new RegExp(`\\b${name}=["']${value}["']`, 'i').test(tag));
  return requested?.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? null;
}

function canonicalFrom(html) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  const canonical = tags.find((tag) => /\brel=["']canonical["']/i.test(tag));
  return canonical?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}

function parseFrontmatter(source, file) {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`Missing frontmatter in ${file}`);
  return parseYaml(match[1]);
}

const htmlFiles = (await filesIn(dist)).filter((file) => file.endsWith('.html'));
const pages = new Map();

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const route = routeFromFile(file);
  const robots = attribute(html, 'meta', 'name', 'robots') ?? '';
  pages.set(route, {
    file,
    html,
    route,
    robots,
    canonical: canonicalFrom(html),
    description: attribute(html, 'meta', 'name', 'description'),
    indexable: !robots.toLowerCase().includes('noindex'),
    incoming: 0,
  });
}

for (const page of pages.values()) {
  for (const match of page.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1];
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    let url;
    try {
      url = new URL(href, `${origin}${page.route}`);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    const linkedRoute = normalizeRoute(url.pathname);
    const target = pages.get(linkedRoute) ?? pages.get(url.pathname);
    if (target && target.route !== page.route) target.incoming += 1;
  }
}

const indexablePages = [...pages.values()].filter((page) => page.indexable && page.route !== '/404');
for (const page of indexablePages) {
  if (!page.canonical) errors.push(`${page.route} is indexable but has no canonical URL`);
  if (!page.description?.trim()) errors.push(`${page.route} is indexable but has no meta description`);
  if (page.route !== '/' && page.incoming === 0) errors.push(`${page.route} is an orphan indexable page`);
}

const descriptions = new Map();
for (const page of indexablePages) {
  const normalized = page.description?.trim().toLocaleLowerCase('ru');
  if (!normalized) continue;
  const matches = descriptions.get(normalized) ?? [];
  matches.push(page.route);
  descriptions.set(normalized, matches);
}
for (const routes of descriptions.values()) {
  if (routes.length > 1) errors.push(`duplicate meta description: ${routes.join(', ')}`);
}

const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8');
const sitemapRoutes = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => normalizeRoute(new URL(match[1]).pathname));
for (const route of sitemapRoutes) {
  const page = pages.get(route);
  if (!page) errors.push(`sitemap route was not built: ${route}`);
  else if (!page.indexable) errors.push(`noindex route appears in sitemap: ${route}`);
}

const robotsText = await readFile(join(dist, 'robots.txt'), 'utf8');
if (/Disallow:\s*\/go\/?/i.test(robotsText)) errors.push('robots.txt blocks /go/, so crawlers cannot read its noindex directive');

for (const route of ['/webinar/', '/go/webinar/']) {
  const page = pages.get(route);
  if (!page) errors.push(`${route} was not built`);
  else if (page.indexable) errors.push(`${route} must be noindex`);
  if (sitemapRoutes.includes(route)) errors.push(`${route} must not appear in sitemap.xml`);
}

const articleFiles = (await readdir(articlesDirectory)).filter((file) => file.endsWith('.md'));
const pillarArticles = [];
for (const file of articleFiles) {
  const data = parseFrontmatter(await readFile(join(articlesDirectory, file), 'utf8'), file);
  if (data.status !== 'published' || !data.pillar) continue;
  const topic = getTopicById(data.pillar);
  if (!topic) {
    errors.push(`${file} refers to unknown pillar ${data.pillar}`);
    continue;
  }
  const articleRoute = `/articles/${data.slug}/`;
  const pillarRoute = `/topics/${topic.slug}/`;
  const articlePage = pages.get(articleRoute);
  const pillarPage = pages.get(pillarRoute);
  pillarArticles.push(data.slug);
  if (!articlePage) errors.push(`${file} has no built article page`);
  else if (!new RegExp(`href=["']${pillarRoute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(articlePage.html)) {
    errors.push(`${articleRoute} does not link to its pillar ${pillarRoute}`);
  }
  if (!pillarPage?.indexable) errors.push(`${pillarRoute} is missing or non-indexable`);
}

const requiredIzmenaPillarArticles = [
  'kak-perezhit-izmenu-zheny',
  'chto-delat-v-pervye-dni-posle-izmeny',
  'razgovor-s-zhenoy-posle-izmeny',
  'vosstanovit-doverie-posle-izmeny',
  'pauza-posle-izmeny',
  'prostit-ili-uyti-posle-izmeny',
];
for (const slug of requiredIzmenaPillarArticles) {
  if (!pillarArticles.includes(slug)) errors.push(`${slug} is missing the izmena pillar relation`);
}

const requiredZhenaHochetUyitiPillarArticles = [
  'zhena-hochet-razvoda-chto-delat',
  'zhena-skazala-chto-ne-lyubit',
];
for (const slug of requiredZhenaHochetUyitiPillarArticles) {
  if (!pillarArticles.includes(slug)) errors.push(`${slug} is missing the zhena-hochet-uyti pillar relation`);
}

if (errors.length) {
  console.error(`SEO architecture check failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`SEO architecture check passed: ${indexablePages.length} indexable pages, ${pillarArticles.length} article-to-pillar relations, no orphans or duplicate descriptions.`);
}
