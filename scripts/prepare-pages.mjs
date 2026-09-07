import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const entryFile = join(distDir, 'index.html');
const sitemapFile = join(distDir, 'sitemap.xml');
const entryHtml = readFileSync(entryFile);
const sitemap = readFileSync(sitemapFile, 'utf8');
const sitemapRoutes = [...sitemap.matchAll(/<loc>https:\/\/sokolovskyi\.pro([^<]*)<\/loc>/g)]
  .map(([, route]) => route)
  .filter((route) => route !== '/');

for (const route of sitemapRoutes) {
  const routeDirectory = join(distDir, route.replace(/^\//, '').replace(/\/$/, ''));
  const routeFile = join(routeDirectory, 'index.html');
  mkdirSync(dirname(routeFile), { recursive: true });
  copyFileSync(entryFile, routeFile);
}

copyFileSync(entryFile, join(distDir, '404.html'));
console.log(`Prepared ${sitemapRoutes.length} static route entry points and 404.html`);
