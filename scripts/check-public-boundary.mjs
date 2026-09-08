import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const errors = [];
const forbiddenPath = /(^|\/)(private-sources|transcriptions?|transcripts?|internal-editorial|personal-knowledge|cases)(\/|$)/i;
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

if (errors.length) {
  console.error(`Public boundary check failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Public boundary check passed: ${files.length} dist files contain no private materials.`);
}
