import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const exists = async (path) => access(path).then(() => true).catch(() => false);
const routeFile = (path) => join(dist, path === '/' ? 'index.html' : path === '/404' ? '404.html' : path === '/go/webinar' ? 'go/webinar/index.html' : path.replace(/^\//, '') + 'index.html');
const required = ['/', '/about/', '/method/', '/webinar/', '/articles/', '/topics/', '/contacts/', '/editorial-policy/', '/privacy-policy/', '/cookie-policy/', '/personal-data-consent/', '/information-boundaries/', '/go/webinar', '/404'];
const baseline = JSON.parse(await readFile(join(root, 'migration/baseline/route-manifest.json'), 'utf8'));
const errors = [];

for (const path of required) if (!(await exists(routeFile(path)))) errors.push(`missing built route ${path}`);
for (const route of baseline.routes.filter((item) => item.articleSlug)) {
  if (!(await exists(routeFile(route.url)))) errors.push(`missing migrated article route ${route.url}`);
}
for (const emptyTopic of ['/topics/obescenivanie/', '/topics/uverennost/']) {
  if (await exists(routeFile(emptyTopic))) errors.push(`empty topic was generated: ${emptyTopic}`);
}
if (await exists(join(dist, 'cases/index.html'))) errors.push('empty /cases/ catalog was generated');

const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8').catch(() => '');
if (!sitemap) errors.push('missing sitemap.xml');
if (sitemap.includes('/go/webinar') || sitemap.includes('/404') || sitemap.includes('/cases')) errors.push('sitemap contains an excluded service, error, or empty route');
const robots = await readFile(join(dist, 'robots.txt'), 'utf8').catch(() => '');
if (!robots.includes('User-agent: OAI-SearchBot') || !robots.includes('Sitemap: https://sokolovskyi.pro/sitemap.xml')) errors.push('robots.txt is missing OAI-SearchBot or Sitemap directives');

if (errors.length) {
  console.error(`Route verification failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Route verification passed: ${required.length} required routes, ${baseline.routes.filter((item) => item.articleSlug).length} article routes, populated topics only.`);
}
