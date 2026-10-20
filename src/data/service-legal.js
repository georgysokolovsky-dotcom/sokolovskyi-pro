import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { site } from './site.js';

// This switch controls publication, not acceptance of a customer contract.
// A release must also pass validateServiceLegalRelease before routes or links exist.
export const serviceLegal = Object.freeze({
  version: '2026-10-20-v1',
  enabled: false,
  scope: 'new-orders-only',
  origin: site.origin,
  releasePath: 'release/service-legal-release.json',
  contentDirectory: 'src/content/service-legal',
  documents: Object.freeze([
    { id: 'terms', label: 'Условия услуг', path: '/legal/terms/' },
    { id: 'privacy', label: 'Данные участников', path: '/legal/privacy/' },
    { id: 'withdrawal', label: 'Отказ и обращения', path: '/legal/withdrawal/' },
  ].map(Object.freeze)),
});

// These are the unresolved publication facts identified for this release.
// Removing an item from release.requiredFacts must not bypass the gate.
export const requiredServiceLegalFactIds = Object.freeze([
  'new_order_workflow',
  'operating_terms',
  'participant_data_processes',
  'service_classification_and_market',
]);

// Fields for the participant, such as [Имя] and [Номер заказа], are permitted.
// Unresolved publishing decisions must use the explicit [УТОЧНИТЬ: ...] marker.
const publishingPlaceholder = /\[(?:УТОЧНИТЬ|ПОДТВЕРДИТЬ|ЗАПОЛНИТЬ ДО ПУБЛИКАЦИИ)\s*:[^\]]*\]|\b(?:TODO|TBD|FIXME|PLACEHOLDER)\b|\{\{[^}]+\}\}/iu;
const headingPunctuation = /[?？—–]|\s-\s/u;

function hasValue(value) {
  if (typeof value === 'string') return value.trim().length > 0 && !publishingPlaceholder.test(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0 && value.every(hasValue);
  if (value && typeof value === 'object') {
    const entries = Object.values(value);
    return entries.length > 0 && entries.every(hasValue);
  }
  return false;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function serviceLegalMode({ registry = serviceLegal, preview = process.env.LEGAL_PREVIEW === '1' } = {}) {
  if (preview) return 'preview';
  return registry.enabled === true ? 'published' : 'disabled';
}

export function parseServiceLegalDocument(definition, source, registry = serviceLegal) {
  const match = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(definition.id + ': требуется YAML frontmatter с title и version.');
  const frontmatter = parse(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(definition.id + ': неверный frontmatter.');
  }
  if (typeof frontmatter.title !== 'string' || !frontmatter.title.trim()) {
    throw new Error(definition.id + ': отсутствует title.');
  }
  if (frontmatter.version !== registry.version) {
    throw new Error(definition.id + ': версия документа должна быть ' + registry.version + '.');
  }
  const body = match[2].trim();
  if (!body) throw new Error(definition.id + ': текст документа пуст.');
  const headings = [frontmatter.title, ...Array.from(body.matchAll(/^#{1,6}\s+(.+)$/gm), (item) => item[1])];
  if (headings.some((heading) => headingPunctuation.test(heading))) {
    throw new Error(definition.id + ': в заголовках новых документов не используются тире и вопросы.');
  }
  if (/<(?:script|form|input|iframe)\b/iu.test(body)) {
    throw new Error(definition.id + ': документ должен быть текстовым и не содержать форм, акцепта или скриптов.');
  }
  return {
    ...definition,
    title: frontmatter.title.trim(),
    version: frontmatter.version,
    frontmatter,
    body,
    source,
    sha256: createHash('sha256').update(source, 'utf8').digest('hex'),
  };
}

export function readServiceLegalDocuments({ root = process.cwd(), registry = serviceLegal } = {}) {
  return registry.documents.map((definition) => {
    const path = resolve(root, registry.contentDirectory, definition.id + '.md');
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error('Не удалось прочитать ' + definition.id + '.md: ' + describeError(error));
    }
    return parseServiceLegalDocument(definition, source, registry);
  });
}

export function validateServiceLegalRelease({ release, documents, registry = serviceLegal }) {
  const errors = [];
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    return ['Не заполнен ' + registry.releasePath + '.'];
  }
  if (release.version !== registry.version) errors.push('Версия release не совпадает с реестром.');
  if (release.scope !== registry.scope) errors.push('Release должен применяться только к новым заказам.');
  if (!isCalendarDate(release.effectiveFrom) || release.effectiveFrom < registry.version.slice(0, 10)) {
    errors.push('Нужна дата effectiveFrom не ранее даты этой редакции в формате YYYY-MM-DD.');
  }

  const publication = release.publication;
  if (!publication || typeof publication !== 'object') {
    errors.push('Не заполнены параметры publication.');
  } else {
    if (publication.origin !== registry.origin) errors.push('publication.origin должен совпадать с адресом сайта.');
    if (typeof publication.ownerName !== 'string' || !hasValue(publication.ownerName)) {
      errors.push('Не подтверждено имя стороны договора в publication.ownerName.');
    }
    if (typeof publication.contactEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publication.contactEmail)) {
      errors.push('Нужен действующий контакт для обращений в publication.contactEmail.');
    }
    if (publication.orderSpecificationRequired !== true) {
      errors.push('Нужно закрепить обязательность индивидуальных условий каждого заказа.');
    }
  }

  const facts = Array.isArray(release.requiredFacts) ? release.requiredFacts : [];
  const ids = facts.map((fact) => fact?.id);
  for (const id of requiredServiceLegalFactIds) {
    if (!ids.includes(id)) errors.push('Не указан обязательный факт: ' + id + '.');
  }
  if (new Set(ids).size !== ids.length) errors.push('requiredFacts содержит повторяющиеся id.');
  for (const fact of facts) {
    if (!fact || typeof fact.id !== 'string' || !/^[a-z][a-z0-9_-]+$/.test(fact.id)) {
      errors.push('У каждого requiredFact должен быть уникальный текстовый id.');
      continue;
    }
    if (typeof fact.label !== 'string' || !fact.label.trim()) errors.push(fact.id + ': не заполнено описание.');
    if (!hasValue(fact.value)) errors.push(fact.id + ': факт не подтверждён значением.');
    if (!isCalendarDate(fact.confirmedAt)) errors.push(fact.id + ': нужна дата подтверждения YYYY-MM-DD.');
    if (typeof fact.evidence !== 'string' || !hasValue(fact.evidence)) {
      errors.push(fact.id + ': нужен источник или ссылка на зафиксированное решение.');
    }
  }

  for (const definition of registry.documents) {
    const matches = documents.filter((document) => document.id === definition.id);
    if (matches.length !== 1) {
      errors.push('Нужен ровно один документ ' + definition.id + '.');
      continue;
    }
    const document = matches[0];
    if (document.version !== registry.version) errors.push(definition.id + ': неверная версия.');
    if (publishingPlaceholder.test(document.source)) errors.push(definition.id + ': есть незаполненные параметры публикации.');
    if (document.frontmatter.draft === true || ['draft', 'unconfirmed'].includes(document.frontmatter.status)) {
      errors.push(definition.id + ': frontmatter всё ещё помечен как проект.');
    }
    const expectedHash = release.documents?.[definition.id]?.sha256;
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash) || expectedHash !== document.sha256) {
      errors.push(definition.id + ': release должен фиксировать SHA-256 полного актуального Markdown.');
    }
  }
  if (documents.length !== registry.documents.length) errors.push('Состав документов не совпадает с реестром.');
  return errors;
}

export function loadServiceLegalBundle({ root = process.cwd(), registry = serviceLegal, preview = process.env.LEGAL_PREVIEW === '1' } = {}) {
  const mode = serviceLegalMode({ registry, preview });
  // Draft source files and release parameters are not prerequisites for the existing site.
  if (mode === 'disabled') return { mode, documents: [], release: null };

  const documents = readServiceLegalDocuments({ root, registry });
  if (mode === 'preview') return { mode, documents, release: null };

  let release;
  try {
    release = JSON.parse(readFileSync(resolve(root, registry.releasePath), 'utf8'));
  } catch (error) {
    throw new Error('Нельзя опубликовать условия: ' + describeError(error));
  }
  const errors = validateServiceLegalRelease({ release, documents, registry });
  if (errors.length) {
    throw new Error('Публикация условий остановлена:\n' + errors.map((error) => '- ' + error).join('\n'));
  }
  return { mode, documents, release };
}
