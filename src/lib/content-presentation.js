export function readingMinutes(body = '') {
  const text = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s*- \[[^\]]+\]\(#[^)]+\)\s*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#*_`>|]/g, ' ');
  const words = text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? [];
  return Math.max(1, Math.ceil(words.length / 180));
}

export function relatedEntries(entries, slugs) {
  const available = new Map(entries.filter(Boolean).map((entry) => [entry.data.slug, entry]));
  return slugs.map((slug) => available.get(slug)).filter(Boolean);
}

export function summaryItems(body, headings = []) {
  const manual = [...(body ?? '').matchAll(/^- \[([^\]]+)\]\(#([^\)]+)\)/gm)].map((match) => ({ label: match[1], id: match[2] }));
  const rendered = headings.filter((heading) => heading.depth === 2).map(({ text, slug }) => ({ label: text, id: slug }));
  const items = manual.length ? manual : rendered;
  // A manually authored list stays inside Content; avoid duplicating it above.
  return { items, showGenerated: !manual.length && items.length > 0 };
}
