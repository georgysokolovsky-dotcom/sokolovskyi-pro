import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { topics } from '../src/data/topics.js';
import { authors } from '../src/data/authors.js';

const articlesDirectory = join(process.cwd(), 'src', 'content', 'articles');
const publicTopics = new Set(Object.keys(topics));
const publicAuthors = new Set(Object.keys(authors));
const statuses = new Set(['draft', 'review', 'approved', 'published', 'archived']);
const required = ['title', 'description', 'slug', 'topic', 'search_intent', 'author', 'datePublished', 'dateModified', 'sources', 'relatedArticles', 'cta', 'status'];

const errors = [];
const files = (await readdir(articlesDirectory)).filter((file) => /\.(md|mdx)$/.test(file)).sort();
const records = [];

for (const file of files) {
  const source = await readFile(join(articlesDirectory, file), 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    errors.push(`${file}: missing frontmatter`);
    continue;
  }
  let data;
  try {
    data = parse(match[1]) || {};
  } catch (error) {
    errors.push(`${file}: invalid YAML: ${error.message}`);
    continue;
  }
  for (const field of required) if (!(field in data)) errors.push(`${file}: missing ${field}`);
  if (!data.title) errors.push(`${file}: empty title`);
  if (!data.description) errors.push(`${file}: empty description`);
  if (!data.slug) errors.push(`${file}: empty slug`);
  if (!data.topic || !publicTopics.has(data.topic)) errors.push(`${file}: unknown topic ${data.topic ?? '(empty)'}`);
  if (!data.author || !publicAuthors.has(data.author)) errors.push(`${file}: unknown author ${data.author ?? '(empty)'}`);
  if (!statuses.has(data.status)) errors.push(`${file}: invalid status ${data.status ?? '(empty)'}`);
  if (data.datePublished !== null && Number.isNaN(new Date(data.datePublished).getTime())) errors.push(`${file}: invalid datePublished`);
  if (Number.isNaN(new Date(data.dateModified).getTime())) errors.push(`${file}: invalid dateModified`);
  records.push({ file, data });
}

const slugs = new Map();
const canonicals = new Map();
for (const { file, data } of records) {
  if (!data.slug) continue;
  if (slugs.has(data.slug)) errors.push(`duplicate slug ${data.slug}: ${slugs.get(data.slug)} and ${file}`);
  slugs.set(data.slug, file);
  const canonical = `https://sokolovskyi.pro/articles/${data.slug}/`;
  if (canonicals.has(canonical)) errors.push(`duplicate canonical ${canonical}: ${canonicals.get(canonical)} and ${file}`);
  canonicals.set(canonical, file);
}
for (const { file, data } of records) for (const related of data.relatedArticles || []) if (!slugs.has(related)) errors.push(`${file}: relatedArticles points to missing slug ${related}`);

if (errors.length) {
  console.error(`Content validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Content validation passed: ${records.length} files, ${slugs.size} unique slugs, ${canonicals.size} unique canonicals.`);
}
