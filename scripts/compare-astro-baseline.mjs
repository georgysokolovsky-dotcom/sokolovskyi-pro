import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const routeBaseline = JSON.parse(await readFile(join(root, 'migration/baseline/route-manifest.json'), 'utf8'));
const contentBaseline = JSON.parse(await readFile(join(root, 'migration/baseline/articles-content.json'), 'utf8'));
const runtimeBaseline = JSON.parse(await readFile(join(root, 'migration/baseline/article-runtime-manifest.json'), 'utf8'));
const errors = [];
const unescape = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const field = (html, expression) => unescape(html.match(expression)?.[1] ?? '');
const htmlFor = (slug) => readFile(join(root, 'dist', 'articles', slug, 'index.html'), 'utf8');

const repairedLinks = {
  '/articles/vosstanovit-uverennost-posle-predatelstva/': '/articles/vosstanovit-doverie-posle-izmeny/',
};

for (const snapshot of contentBaseline.articles) {
  const html = await htmlFor(snapshot.slug).catch(() => '');
  const route = routeBaseline.routes.find((item) => item.articleSlug === snapshot.slug);
  const runtime = runtimeBaseline.articles.find((item) => item.slug === snapshot.slug);
  if (!html) { errors.push(`${snapshot.slug}: missing HTML`); continue; }
  const actual = {
    title: field(html, /<title>([\s\S]*?)<\/title>/i),
    description: field(html, /<meta name="description" content="([^"]*)"/i),
    canonical: field(html, /<link rel="canonical" href="([^"]*)"/i),
    h1: field(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, '').trim(),
    ogImage: field(html, /<meta property="og:image" content="([^"]*)"/i),
  };
  for (const key of ['title', 'description', 'canonical', 'h1']) if (route && actual[key] !== route[key]) errors.push(`${snapshot.slug}: ${key} differs from baseline`);
  if (!actual.ogImage.endsWith(runtime.socialImage)) errors.push(`${snapshot.slug}: OG image differs from baseline`);
  for (const segment of snapshot.contentText ?? []) if (!html.includes(segment)) errors.push(`${snapshot.slug}: missing source text segment: ${segment.slice(0, 80)}`);
  for (const [, href] of runtime.related) {
    const expected = repairedLinks[href] ?? href;
    if (!html.includes(`href="${expected}"`)) errors.push(`${snapshot.slug}: related link missing ${expected}`);
  }
  const ctaMatches = [...html.matchAll(/href="(\/go\/webinar\?[^\"]+)"/g)].map((match) => new URL(`https://sokolovskyi.pro${unescape(match[1])}`));
  const expectedCta = ctaMatches.find((url) => url.searchParams.get('article_id') === runtime.id && url.searchParams.get('topic') === runtime.topic && url.searchParams.get('placement') === 'inline');
  if (!expectedCta) errors.push(`${snapshot.slug}: article CTA with preserved UTM context is missing`);
  if (html.includes('type="module"')) errors.push(`${snapshot.slug}: module script leaked into article HTML`);
  const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  const articleSchema = jsonLd.find((schema) => schema['@type'] === 'Article');
  const breadcrumbSchema = jsonLd.find((schema) => schema['@type'] === 'BreadcrumbList');
  if (!articleSchema || !breadcrumbSchema) errors.push(`${snapshot.slug}: Article/BreadcrumbList JSON-LD missing`);
  if (articleSchema?.datePublished) errors.push(`${snapshot.slug}: invented datePublished in JSON-LD`);
  if (articleSchema?.citation) errors.push(`${snapshot.slug}: invented source citation in JSON-LD`);
}

if (errors.length) {
  console.error(`Astro baseline comparison failed with ${errors.length} error(s):`);
  errors.slice(0, 100).forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Astro baseline comparison passed: ${contentBaseline.articles.length} articles retain metadata, text, related links, CTA context, and OG images.`);
}
