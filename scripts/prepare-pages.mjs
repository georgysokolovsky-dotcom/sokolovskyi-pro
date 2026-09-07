import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { approvedArticles } from '../src/articleData.js';

const distDir = join(process.cwd(), 'dist');
const entryFile = join(distDir, 'index.html');
const sitemapFile = join(distDir, 'sitemap.xml');
const entryHtml = readFileSync(entryFile);
const sitemap = readFileSync(sitemapFile, 'utf8');
const siteOrigin = 'https://sokolovskyi.pro';
const sitemapRoutes = [...sitemap.matchAll(/<loc>https:\/\/sokolovskyi\.pro([^<]*)<\/loc>/g)]
  .map(([, route]) => route)
  .filter((route) => route !== '/');

const staticMeta = {
  '/': ['PRO Мужчин — когда отношения рушатся, важно не потерять себя', 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.'],
  '/about/': ['Об авторе — PRO Мужчин', 'Георгий Соколовский помогает мужчинам выйти из кризиса после измены, предательства или развода.'],
  '/method/': ['Подход к работе — PRO Мужчин', 'Подход к работе с мужчинами в кризисе отношений: состояние, сценарии, действия, разговор и личные границы.'],
  '/webinar/': ['Бесплатный вебинар — PRO Мужчин', 'Бесплатный вебинар о состоянии, повторяющихся сценариях и решениях в кризисе отношений.'],
  '/articles/': ['Все статьи — PRO Мужчин', 'Статьи о кризисах в отношениях, измене, разводе, ревности и возвращении уверенности.'],
  '/topics/': ['Темы — PRO Мужчин', 'Тематические материалы для мужчин о кризисе отношений, измене, разводе и ревности.'],
  '/contacts/': ['Контакты — PRO Мужчин', 'Контакты проекта PRO Мужчин и переход к регистрации на бесплатный вебинар.'],
};

const topicMeta = {
  'izmena-zheny': ['Измена жены — PRO Мужчин', 'Что делать после предательства, как разговаривать и принимать решения.'],
  razvod: ['Развод и расставание — PRO Мужчин', 'Как пройти перемены без саморазрушения и сохранить контакт с детьми.'],
  vozvrashchenie: ['Возвращение женщины — PRO Мужчин', 'О том, что зависит от твоих решений, а что нельзя контролировать.'],
  revnost: ['Ревность, подозрения и контроль — PRO Мужчин', 'Как перестать жить в проверках и разговаривать о доверии.'],
  'deti-posle-razvoda': ['Дети после развода — PRO Мужчин', 'Как оставаться отцом и принимать решения в интересах ребёнка.'],
};

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function routeMeta(route) {
  const articleSlug = route.match(/^\/articles\/([^/]+)\/$/)?.[1];
  const article = articleSlug ? approvedArticles[articleSlug] : null;
  const topicSlug = route.match(/^\/topics\/([^/]+)\/$/)?.[1];
  const meta = article
    ? [`${article.title} — PRO Мужчин`, article.description]
    : topicSlug && topicMeta[topicSlug]
      ? topicMeta[topicSlug]
      : staticMeta[route] || staticMeta['/'];
  const image = article ? `${siteOrigin}/images/social/${article.id}-social.svg` : `${siteOrigin}/images/georgiy-portrait.png`;
  return { title: meta[0], description: meta[1], image, canonical: `${siteOrigin}${route}` };
}

function withRouteMeta(html, route) {
  const meta = routeMeta(route);
  const title = escapeAttribute(meta.title);
  const description = escapeAttribute(meta.description);
  const canonical = escapeAttribute(meta.canonical);
  const image = escapeAttribute(meta.image);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(" \/>)/, `$1${description}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(" \/>)/, `$1${canonical}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(" \/>)/, `$1${canonical}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(" \/>)/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(" \/>)/, `$1${description}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(" \/>)/, `$1${image}$2`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*(" \/>)/, `$1${title}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(" \/>)/, `$1${title}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(" \/>)/, `$1${description}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(" \/>)/, `$1${image}$2`);
}

for (const route of sitemapRoutes) {
  const routeDirectory = join(distDir, route.replace(/^\//, '').replace(/\/$/, ''));
  const routeFile = join(routeDirectory, 'index.html');
  mkdirSync(dirname(routeFile), { recursive: true });
  const routeHtml = withRouteMeta(entryHtml.toString(), route);
  writeFileSync(routeFile, routeHtml);
}

copyFileSync(entryFile, join(distDir, '404.html'));
console.log(`Prepared ${sitemapRoutes.length} static route entry points and 404.html`);
