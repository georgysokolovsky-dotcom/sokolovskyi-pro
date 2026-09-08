import { mkdir, writeFile } from 'node:fs/promises';
import { approvedArticles } from '../src/articleData.js';

const outputDirectory = new URL('../src/content/articles/', import.meta.url);
const yamlQuote = (value) => JSON.stringify(value);
const markdownParagraph = (value) => `${value.trim()}\n`;
const searchIntentById = {
  article_0001: 'informational',
  article_0002: 'informational',
  article_0003: 'informational',
  article_0004: 'decision support',
  article_0005: 'informational',
  article_0006: 'informational',
  article_0007: 'informational',
  article_0008: 'informational',
  article_0009: 'informational',
  article_0010: 'informational',
  article_0011: 'decision support',
  article_0012: 'decision support',
  article_0013: 'decision support',
  article_0014: 'informational',
  article_0015: 'informational',
};
const relatedSlugRepairs = {
  'vosstanovit-uverennost-posle-predatelstva': 'vosstanovit-doverie-posle-izmeny',
};

const renderBlock = (block) => {
  if (block.type === 'callout') return `> ${block.text.trim()}\n`;
  if (block.type !== 'section') throw new Error(`Unsupported article block type: ${block.type}`);

  const lines = [`<a id="${block.id}"></a>`, `## ${block.title.trim()}`, ''];
  for (const paragraph of block.paragraphs || []) lines.push(markdownParagraph(paragraph), '');
  if (block.bullets?.length) lines.push(...block.bullets.map((bullet) => `- ${bullet.trim()}`), '');
  if (block.steps?.length) lines.push(...block.steps.map(([title, description]) => `1. **${title.trim()}** ${description.trim()}`), '');
  return lines.join('\n');
};

const renderArticle = (article) => {
  const frontmatter = [
    '---',
    `title: ${yamlQuote(article.title)}`,
    `description: ${yamlQuote(article.description)}`,
    `slug: ${yamlQuote(article.slug)}`,
    `topic: ${yamlQuote(article.topic)}`,
    `search_intent: ${yamlQuote(searchIntentById[article.id] || null)}`,
    'author: "georgiy-sokolovsky"',
    'datePublished: null',
    `dateModified: ${yamlQuote('2026-09-05')}`,
    'sources: []',
    `relatedArticles: ${JSON.stringify(article.related.map(([, href]) => {
      const slug = href.replace(/^\/articles\//, '').replace(/\/$/, '');
      return relatedSlugRepairs[slug] || slug;
    }))}`,
    'cta:',
    '  type: "webinar"',
    '  label: "Записаться на бесплатный вебинар"',
    'status: "published"',
    `article_id: ${yamlQuote(article.id)}`,
    `category: ${yamlQuote(article.category)}`,
    `readingTime: ${yamlQuote(article.readingTime)}`,
    'unresolvedFields:',
    '  - datePublished',
    '  - sources',
    '---',
    '',
    article.intro.trim(),
    '',
    `> ${article.asideNote.trim()}`,
    '',
    '## Коротко',
    '',
    ...article.summary.map(([label, id]) => `- [${label}](#${id})`),
    '',
    ...article.blocks.map(renderBlock),
  ];
  return `${frontmatter.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
};

await mkdir(outputDirectory, { recursive: true });
for (const article of Object.values(approvedArticles)) {
  await writeFile(new URL(`${article.slug}.md`, outputDirectory), renderArticle(article));
}
console.log(`Migrated ${Object.keys(approvedArticles).length} article records to Markdown.`);
