import { articlePath } from './site-routes.js';

export const articleCardOrder = [
  'kak-perezhit-izmenu-zheny',
  'chto-delat-v-pervye-dni-posle-izmeny',
  'razgovor-s-zhenoy-posle-izmeny',
  'prostit-ili-uyti-posle-izmeny',
  'vosstanovit-doverie-posle-izmeny',
  'pauza-posle-izmeny',
  'kak-perezhit-razvod',
  'skazat-detyam-o-razvode',
  'obshchatsya-s-byvshey-posle-razvoda',
  'sohranit-kontakt-s-detmi-posle-razvoda',
  'stoit-li-vozvrashchat-zhenu',
  'zhena-ushla-i-hochet-vernutsya',
  'vosstanovit-otnosheniya-posle-razryva',
  'perestat-proveryat-telefon-zheny',
  'revnost-i-podozreniya-chto-delat',
];

export function publishedArticles(entries) {
  return entries.filter(({ data }) => data.status === 'published');
}

export function sortArticles(entries) {
  const order = new Map(articleCardOrder.map((slug, index) => [slug, index]));
  return [...entries].sort((a, b) => (order.get(a.data.slug) ?? 999) - (order.get(b.data.slug) ?? 999));
}

export function articleCardData(entry) {
  const { data } = entry;
  return {
    href: articlePath(data.slug),
    title: data.title,
    description: data.description,
    time: (data.readingTime ?? '').replace(/\s*чтения?$/i, ''),
  };
}

export function findArticle(entries, slug) {
  return entries.find((entry) => entry.data.slug === slug) ?? null;
}
