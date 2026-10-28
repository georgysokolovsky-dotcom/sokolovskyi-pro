import { parse } from 'yaml';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const errors = [];
const forbiddenPath = /(^|\/)(private-sources|transcriptions?|transcripts?|internal-editorial|personal-knowledge|__drafts|local-preview|site-release|cases)(\/|$)/i;
const forbiddenText = /PRIVATE[_ -]ONLY|INTERNAL[_ -]ONLY|PRIVATE[-_ ]SOURCE/i;

async function filesIn(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await filesIn(path));
    else result.push(path);
  }
  return result;
}

const files = await filesIn(dist);
for (const file of files) {
  const relativePath = relative(dist, file).replace(/\\/g, '/');
  if (/\.(md|mdx)$/i.test(relativePath)) errors.push(`source file leaked: ${relativePath}`);
  if (forbiddenPath.test(relativePath)) errors.push(`private path leaked: ${relativePath}`);
  const content = await readFile(file).catch(() => Buffer.alloc(0));
  if (forbiddenText.test(content.toString('utf8'))) errors.push(`private marker leaked: ${relativePath}`);
}
if (files.some((file) => relative(dist, file).replace(/\\/g, '/') === 'cases/index.html')) errors.push('empty cases catalog leaked');

const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8');
const articleFiles = await readdir(join(root, 'src/content/articles'));
for (const name of articleFiles.filter((name) => /\.mdx?$/.test(name))) {
  const source = await readFile(join(root, 'src/content/articles', name), 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  const data = parse(match?.[1] || '');
  if (data?.status === 'published') continue;
  const path = `/articles/${data.slug}/`;
  if (sitemap.includes(path)) errors.push(`unpublished article in sitemap: ${data.slug}`);
  if (files.some((file) => file === join(dist, 'articles', data.slug, 'index.html'))) errors.push(`unpublished article built: ${data.slug}`);
  for (const file of files.filter((file) => /\.html$/.test(file))) {
    const html = await readFile(file, 'utf8');
    if (html.includes(path)) errors.push(`public link to unpublished article: ${data.slug}`);
  }
}
if (errors.length) {
  console.error(`Public boundary check failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Public boundary check passed: ${files.length} dist files contain no private materials.`);
}
