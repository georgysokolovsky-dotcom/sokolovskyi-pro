import { authors } from '../data/authors.js';
import { site } from '../data/site.js';
import { absoluteUrl, articlePath } from './site-routes.js';

export function articleSocialImage(article) {
  const imageName = article.data?.article_id;
  return imageName ? `${site.origin}/images/social/${imageName}-social.svg` : `${site.origin}${authors[site.authorId].image}`;
}

export function buildWebsiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${site.origin}/#website`,
    name: site.name,
    url: `${site.origin}/`,
    inLanguage: 'ru-RU',
  };
}

export function buildPersonJsonLd() {
  const author = authors[site.authorId];
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': author.personId,
    name: author.name,
    url: absoluteUrl(author.url),
    jobTitle: author.role,
  };
}

export function buildBreadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: item.href ? absoluteUrl(item.href) : undefined,
    })),
  };
}

export function buildArticleJsonLd(article, topic) {
  const data = article.data;
  const author = authors[data.author];
  const result = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${absoluteUrl(articlePath(data.slug))}#article`,
    mainEntityOfPage: absoluteUrl(articlePath(data.slug)),
    headline: data.title,
    description: data.description,
    image: articleSocialImage(article),
    author: { '@id': author.personId },
    dateModified: data.dateModified.toISOString(),
    articleSection: topic?.label,
    inLanguage: 'ru-RU',
    isPartOf: { '@id': `${site.origin}/#website` },
  };
  if (data.datePublished) result.datePublished = data.datePublished.toISOString();
  return result;
}

export function robotsForPage({ indexable = true, legalStatus } = {}) {
  if (legalStatus && legalStatus !== 'approved') return 'noindex, follow';
  return indexable ? 'index, follow' : 'noindex, follow';
}
