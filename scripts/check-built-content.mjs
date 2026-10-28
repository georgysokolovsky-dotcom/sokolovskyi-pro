import { readdir, readFile, access } from 'node:fs/promises';
import { parse } from 'yaml';
import { join } from 'node:path';
import { articleSocialImage } from '../src/lib/seo.js';
import { readingMinutes } from '../src/lib/content-presentation.js';
const root = process.cwd();
const errors = [];
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
let count = 0;
for (const file of (await readdir(join(root, 'src/content/articles'))).filter((file) => file.endsWith('.md'))) {
  const source = await readFile(join(root, 'src/content/articles', file), 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  const data = parse(match[1]);
  if (data.status !== 'published') continue;
  count++;
  const body = source.slice(match[0].length);
  const html = await readFile(join(root, 'dist/articles', data.slug, 'index.html'), 'utf8').catch(() => '');
  if (!html) { errors.push(`${file}: missing built published article`); continue; }
  const ctas = [...html.matchAll(/<a\b[^>]*data-webinar-cta[^>]*>/g)].map((match) => match[0]);
  const placements = ctas.map((tag) => attribute(tag, 'data-placement'));
  for (const tag of ctas) {
    const id = data.article_id ?? data.slug;
    if (attribute(tag, 'data-article-id') !== id || attribute(tag, 'data-topic') !== data.topic) errors.push(`${file}: wrong article context in CTA`);
    const href = new URL(attribute(tag, 'href').replaceAll('&amp;', '&'), 'https://sokolovskyi.pro');
    if (href.searchParams.get('article_id') !== id || href.searchParams.get('page_id') !== data.slug || href.searchParams.get('page_type') !== 'article') errors.push(`${file}: wrong URL context in CTA`);
  }
  if (placements.filter((value) => value === 'article_end').length !== 1 || !placements.includes('header') || !placements.includes('header_mobile')) errors.push(`${file}: missing or duplicate CTA placement`);
  if (ctas.length !== 3) errors.push(`${file}: expected two menu variants and one article-end CTA, got ${ctas.length}`);
  if (!html.includes(`${readingMinutes(body)} мин чтения`)) errors.push(`${file}: reading time differs from body`);
  if (/<div class="article-summary"[^>]*>\s*<strong>В статье:<\/strong>\s*<\/div>/.test(html)) errors.push(`${file}: empty table of contents`);
  if (html.includes('/undefined-social') || /og:image[^>]+undefined/.test(html)) errors.push(`${file}: undefined social image`);
  const images = [...html.matchAll(/<meta[^>]+(?:property="og:image"|name="twitter:image")[^>]+content="([^"]+)"/g)].map((m) => m[1]);
  if (images.length !== 2 || images.some((image) => image !== articleSocialImage({ data }))) errors.push(`${file}: social metadata does not match the available article image`);
  for (const image of images) if (!(await access(join(root, 'dist', new URL(image).pathname)).then(() => true).catch(() => false))) errors.push(`${file}: missing social image`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Built content check passed: ${count} published articles, exact context/CTA count, reading time, nonempty TOC and social images.`);
