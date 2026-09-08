export const topics = {
  izmena: {
    id: 'izmena',
    slug: 'izmena-zheny',
    label: 'Измена жены',
    description: 'Что делать после предательства, как разговаривать и принимать решения.',
  },
  razvod: {
    id: 'razvod',
    slug: 'razvod',
    label: 'Развод и расставание',
    description: 'Как пройти перемены без саморазрушения и сохранить контакт с детьми.',
  },
  vozvrashchenie: {
    id: 'vozvrashchenie',
    slug: 'vozvrashchenie',
    label: 'Возвращение женщины',
    description: 'О том, что зависит от твоих решений, а что нельзя контролировать.',
  },
  revnost: {
    id: 'revnost',
    slug: 'revnost',
    label: 'Ревность, подозрения и контроль',
    description: 'Как перестать жить в проверках и разговаривать о доверии.',
  },
  'deti-posle-razvoda': {
    id: 'deti-posle-razvoda',
    slug: 'deti-posle-razvoda',
    label: 'Дети после развода',
    description: 'Как оставаться отцом и принимать решения в интересах ребёнка.',
  },
};

export const topicList = Object.values(topics);

export function getTopicById(id) {
  return topics[id] ?? null;
}

export function getTopicBySlug(slug) {
  return topicList.find((topic) => topic.slug === slug) ?? null;
}
