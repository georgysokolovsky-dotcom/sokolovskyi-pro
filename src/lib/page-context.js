import { getTopicBySlug } from '../data/topics.js';

export function pageContext(pathname, overrides = {}) {
  const segments = pathname.split('/').filter(Boolean);
  const isArticle = segments[0] === 'articles' && Boolean(segments[1]);
  const topic = segments[0] === 'topics' ? getTopicBySlug(segments[1]) : null;
  const id = isArticle ? segments[1] : topic ? `topic_${topic.id}` : segments.join('_') || 'home';
  return {
    page_id: id,
    page_type: isArticle ? 'article' : topic ? 'topic' : 'site',
    article_id: isArticle ? id : '',
    topic: topic?.id ?? 'overview',
    ...overrides,
  };
}
