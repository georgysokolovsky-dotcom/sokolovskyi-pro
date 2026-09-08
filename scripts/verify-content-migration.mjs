import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const baseline = JSON.parse(await readFile(join(process.cwd(), 'migration', 'baseline', 'articles-content.json'), 'utf8'));
const errors = [];

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
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
  const distFile = join(process.cwd(), 'dist', 'articles', snapshot.slug, 'index.html');
  let rendered;
  try {
    rendered = await readFile(distFile, 'utf8');
  } catch {
    errors.push(`${snapshot.slug}: missing static build output ${distFile}`);
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
