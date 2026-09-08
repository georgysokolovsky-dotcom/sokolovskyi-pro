import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.string().url().optional(),
  status: z.enum(['verified', 'unverified', 'insufficient_data']).default('verified'),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

const ctaSchema = z.object({
  type: z.literal('webinar'),
  label: z.string().min(1),
});

const articleSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  topic: z.string().min(1),
  search_intent: z.string().min(1).nullable(),
  author: z.string().min(1),
  datePublished: z.coerce.date().nullable(),
  dateModified: z.coerce.date(),
  sources: z.array(sourceSchema),
  relatedArticles: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  cta: ctaSchema,
  status: z.enum(['draft', 'review', 'approved', 'published', 'archived']),
  article_id: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  readingTime: z.string().min(1).optional(),
  unresolvedFields: z.array(z.string()).default([]),
  extra: z.record(z.unknown()).optional(),
});

export const collections = {
  articles: defineCollection({
    loader: glob({ base: './src/content/articles', pattern: '**/*.{md,mdx}' }),
    schema: articleSchema,
  }),
};
