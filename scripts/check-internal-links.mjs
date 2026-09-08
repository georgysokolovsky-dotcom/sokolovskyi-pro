import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
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

const allFiles = await filesIn(dist);
const htmlFiles = allFiles.filter((file) => file.endsWith('.html'));
const builtRoutes = new Set(allFiles.map((file) => {
  const route = `/${relative(dist, file).replace(/\\/g, '/')}`;
  return route === '/index.html' ? '/' : route.replace(/index\.html$/, '');
}));
const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(hrefPattern)) {
    const href = match[1];
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/_')) continue;
    const path = new URL(href, 'https://sokolovskyi.pro').pathname;
    const normalized = path === '/' ? '/' : `${path.replace(/\/+$/, '')}/`;
    if (!builtRoutes.has(path) && !builtRoutes.has(normalized)) errors.push(`${relative(root, file)} -> ${href}`);
  }
}

if (errors.length) {
  console.error(`Internal link check failed with ${errors.length} broken link(s):`);
  errors.slice(0, 50).forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Internal link check passed: ${htmlFiles.length} HTML files checked.`);
}
