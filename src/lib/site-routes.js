import { topics } from '../data/topics.js';
import { site } from '../data/site.js';

export const staticIndexableRoutes = [
  '/',
  '/about/',
  '/method/',
  '/webinar/',
  '/articles/',
  '/topics/',
  '/contacts/',
  '/editorial-policy/',
  '/privacy-policy/',
  '/cookie-policy/',
  '/personal-data-consent/',
  '/information-boundaries/',
];

export function normalizePath(path) {
  if (!path || path === '/') return '/';
  const value = path.split('?')[0].split('#')[0];
  return `${value.replace(/\/+$/, '')}/`;
}

export function absoluteUrl(path) {
  return new URL(normalizePath(path), `${site.origin}/`).toString();
}

export function articlePath(slug) {
  return `/articles/${slug}/`;
}

export function topicPath(topicId) {
  const topic = topics[topicId] ?? null;
  return topic ? `/topics/${topic.slug}/` : null;
}

export function getTopicFromArticle(article) {
  return topics[article.data?.topic ?? article.topic] ?? null;
}

export function getTopicBySlug(slug) {
  return Object.values(topics).find((topic) => topic.slug === slug) ?? null;
}
