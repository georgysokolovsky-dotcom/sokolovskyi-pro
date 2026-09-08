import { authors } from '../data/authors.js';
import { topics } from '../data/topics.js';
import { articlePath, absoluteUrl, staticIndexableRoutes } from './site-routes.js';

export function validateArticleEntries(entries, { origin = 'https://sokolovskyi.pro' } = {}) {
  const errors = [];
  const slugs = new Map();
  const canonicals = new Map();

  for (const entry of entries) {
    const data = entry.data || entry;
    const sourceId = entry.id || data.slug || 'unknown-entry';
    if (!data.title) errors.push(`${sourceId}: missing title`);
    if (!data.description) errors.push(`${sourceId}: missing description`);
    if (!data.slug) errors.push(`${sourceId}: missing slug`);
    if (!data.topic || !topics[data.topic]) errors.push(`${sourceId}: unknown topic ${data.topic ?? '(empty)'}`);
    if (!data.author || !authors[data.author]) errors.push(`${sourceId}: unknown author ${data.author ?? '(empty)'}`);
    if (!data.status) errors.push(`${sourceId}: missing status`);
    if (data.slug) {
      if (slugs.has(data.slug)) errors.push(`duplicate slug ${data.slug}: ${slugs.get(data.slug)} and ${sourceId}`);
      slugs.set(data.slug, sourceId);
      const canonical = `${origin}${articlePath(data.slug)}`;
      if (canonicals.has(canonical)) errors.push(`duplicate canonical ${canonical}: ${canonicals.get(canonical)} and ${sourceId}`);
      canonicals.set(canonical, sourceId);
    }
  }

  for (const entry of entries) {
    const data = entry.data || entry;
    const sourceId = entry.id || data.slug || 'unknown-entry';
    for (const related of data.relatedArticles || []) {
      if (!slugs.has(related)) errors.push(`${sourceId}: relatedArticles points to missing slug ${related}`);
    }
  }

  if (errors.length) throw new Error(`Article validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  return { count: entries.length, slugs: slugs.size, canonicals: canonicals.size };
}

export function validateStaticCanonicals() {
  const seen = new Set();
  const duplicates = [];
  for (const path of staticIndexableRoutes) {
    const canonical = absoluteUrl(path);
    if (seen.has(canonical)) duplicates.push(canonical);
    seen.add(canonical);
  }
  if (duplicates.length) throw new Error(`Static canonical validation failed: ${duplicates.join(', ')}`);
  return seen.size;
}
