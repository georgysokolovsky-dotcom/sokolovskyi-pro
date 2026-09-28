import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const baseline = JSON.parse(await readFile(join(process.cwd(), 'migration', 'baseline', 'articles-content.json'), 'utf8'));
const errors = [];

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const htmlText = (value) => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

const textSegments = (article) => [
  article.intro,
  article.asideNote,
  ...(article.summary || []).flat(),
  ...(article.blocks || []).flatMap((block) => [
    block.title,
    block.text,
    ...(block.paragraphs || []),
    ...(block.bullets || []),
    ...(block.steps || []).flat(),
  ]),
].filter(Boolean);

for (const snapshot of baseline.articles) {
  const file = join(process.cwd(), 'src', 'content', 'articles', `${snapshot.slug}.md`);
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    errors.push(`${snapshot.slug}: missing Markdown file`);
    continue;
  }
  const sourceMatch = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const body = sourceMatch?.[2] ?? '';
  const distFile = join(process.cwd(), 'dist', 'articles', snapshot.slug, 'index.html');
  let rendered;
  try {
    rendered = await readFile(distFile, 'utf8');
  } catch {
    errors.push(`${snapshot.slug}: missing static build output ${distFile}`);
  }

  if (snapshot.approvedRewrite) {
    let frontmatter = {};
    try {
      frontmatter = parseYaml(sourceMatch?.[1] ?? '');
    } catch {
      errors.push(`${snapshot.slug}: invalid Markdown frontmatter`);
    }

    if (frontmatter.slug !== snapshot.slug) errors.push(`${snapshot.slug}: approved rewrite slug differs from baseline`);
    if (frontmatter.title !== snapshot.title) errors.push(`${snapshot.slug}: approved rewrite title differs from baseline`);
    if (!body.trim()) errors.push(`${snapshot.slug}: approved rewrite content is empty`);
    if (sha256(body) !== snapshot.approvedRewrite.sourceBodySha256) {
      errors.push(`${snapshot.slug}: approved rewrite content differs from approved snapshot`);
    }

    if (rendered) {
      if (!rendered.includes(`data-article-slug="${snapshot.slug}"`)) {
        errors.push(`${snapshot.slug}: build output is missing the approved article route`);
      }
      const h1 = htmlText(rendered.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
      if (h1 !== snapshot.title) errors.push(`${snapshot.slug}: build output H1 differs from approved title`);
      const articleText = htmlText(rendered.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? '');
      if (!articleText) errors.push(`${snapshot.slug}: build output article content is empty`);
    }

    for (const marker of snapshot.approvedRewrite.requiredMarkers) {
      if (!body.includes(marker)) errors.push(`${snapshot.slug}: approved source marker missing: ${marker}`);
      if (rendered && !rendered.includes(marker)) errors.push(`${snapshot.slug}: approved build marker missing: ${marker}`);
    }
    continue;
  }

  for (const segment of textSegments(snapshot.original)) {
    if (!body.includes(segment)) errors.push(`${snapshot.slug}: missing content segment: ${segment.slice(0, 80)}`);
    if (rendered && !rendered.includes(segment)) errors.push(`${snapshot.slug}: build output missing content segment: ${segment.slice(0, 80)}`);
  }
}

if (errors.length) {
  console.error(`Content migration verification failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Content migration verification passed: ${baseline.articles.length} articles and all source text segments retained.`);
}
