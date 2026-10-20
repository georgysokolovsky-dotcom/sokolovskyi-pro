import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  loadServiceLegalBundle,
  isSharedMyTermsUrl,
  parseServiceLegalDocument,
  requiredServiceLegalFactIds,
  serviceLegal,
  validateServiceLegalRelease,
} from '../src/data/service-legal.js';

const args = process.argv.slice(2);
let distDirectory = null;
let forceRelease = false;
let selfTest = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--release') forceRelease = true;
  else if (args[index] === '--self-test') selfTest = true;
  else if (args[index] === '--dist' && args[index + 1] && !args[index + 1].startsWith('--')) {
    distDirectory = resolve(args[++index]);
  } else {
    throw new Error('Неизвестный или неполный аргумент: ' + args[index]);
  }
}

function verifyGate() {
  const documents = serviceLegal.documents.map((definition) => parseServiceLegalDocument(
    definition,
    '---\ntitle: ' + JSON.stringify(definition.label) + '\nversion: ' + JSON.stringify(serviceLegal.version)
      + '\n---\n\n## Проверочный документ\n\nПолный текст проверочного примера для проверки механизма публикации.'
      + '\n\nПоля для участника: [Имя участника], [Номер заказа].\n',
  ));
  const release = {
    version: serviceLegal.version,
    scope: 'new-orders-only',
    effectiveFrom: serviceLegal.version.slice(0, 10),
    publication: {
      origin: serviceLegal.origin,
      ownerName: 'Исполнитель проверочного примера',
      contactEmail: 'release-check@example.invalid',
      orderSpecificationRequired: true,
      myTermsUrl: 'https://participant.example.invalid/my-terms',
      myTermsAuthorizationVerified: true,
    },
    requiredFacts: requiredServiceLegalFactIds.map((id) => ({
      id,
      label: id,
      value: 'Подтверждённое значение проверочного примера',
      confirmedAt: serviceLegal.version.slice(0, 10),
      evidence: 'Изолированный пример для проверки gate, не данные публикации',
    })),
    documents: Object.fromEntries(documents.map((document) => [document.id, { sha256: document.sha256 }])),
  };
  const errorsFor = (candidate, candidateDocuments = documents) =>
    validateServiceLegalRelease({ release: candidate, documents: candidateDocuments });

  assert.deepEqual(errorsFor(release), [], 'A complete fixture and participant fields must pass.');
  assert.ok(errorsFor(null).length, 'Missing release must fail.');

  for (const url of [
    'https://participant.example.invalid/my-terms',
    'https://participant.example.invalid/my-terms/',
    'https://t.me/example_participant_bot',
  ]) assert.ok(isSharedMyTermsUrl(url), 'Shared entry point must be allowed: ' + url);
  for (const url of [
    null, '', 'http://participant.example.invalid/my-terms',
    'https://participant.example.invalid/my-terms?token=synthetic',
    'https://participant.example.invalid/my-terms?',
    'https://participant.example.invalid/my-terms#synthetic',
    'https://participant.example.invalid/my-terms/ORDER-EXAMPLE',
    'https://name:password@participant.example.invalid/my-terms',
    'https://localhost/my-terms', 'https://127.0.0.1/my-terms',
    'https://t.me/example_participant_bot?start=synthetic',
    'https://t.me/+synthetic-invitation',
  ]) assert.equal(isSharedMyTermsUrl(url), false, 'Private or invalid entry point must fail.');
  const missingMyTerms = structuredClone(release);
  missingMyTerms.publication.myTermsUrl = null;
  assert.ok(errorsFor(missingMyTerms).some((error) => error.includes('myTermsUrl')));
  const unverifiedMyTerms = structuredClone(release);
  unverifiedMyTerms.publication.myTermsAuthorizationVerified = false;
  assert.ok(errorsFor(unverifiedMyTerms).some((error) => error.includes('идентификацию участника')));

  const emptyFacts = structuredClone(release);
  emptyFacts.requiredFacts = [];
  const missingFactErrors = errorsFor(emptyFacts);
  for (const id of requiredServiceLegalFactIds) {
    assert.ok(missingFactErrors.some((error) => error.includes(id)), 'A missing mandatory fact must fail: ' + id);
  }

  const unresolved = structuredClone(release);
  unresolved.requiredFacts[0].value = null;
  assert.ok(errorsFor(unresolved).some((error) => error.includes('факт не подтверждён')));

  const missingDocument = documents.slice(0, -1);
  assert.ok(errorsFor(release, missingDocument).some((error) => error.includes('withdrawal')));

  const wrongVersion = structuredClone(release);
  wrongVersion.version = 'other';
  assert.ok(errorsFor(wrongVersion).some((error) => error.includes('Версия release')));

  const modified = parseServiceLegalDocument(serviceLegal.documents[0], documents[0].source + '\nДополнение.\n');
  assert.ok(errorsFor(release, [modified, ...documents.slice(1)]).some((error) => error.includes('SHA-256')));

  const placeholder = parseServiceLegalDocument(serviceLegal.documents[0], documents[0].source + '\n[УТОЧНИТЬ: срок услуги]\n');
  const placeholderRelease = structuredClone(release);
  placeholderRelease.documents.terms.sha256 = placeholder.sha256;
  assert.ok(errorsFor(placeholderRelease, [placeholder, ...documents.slice(1)])
    .some((error) => error.includes('незаполненные параметры')));

  const disabled = loadServiceLegalBundle({
    root: resolve('__nonexistent_service_legal_fixture__'),
    registry: { ...serviceLegal, enabled: false },
    preview: false,
  });
  assert.equal(disabled.mode, 'disabled');
  assert.deepEqual(disabled.documents, [], 'Disabled publication must not expose routes or need draft files.');
  console.log('Service legal gate checks passed: required facts, versions, hashes, placeholders and shared authorized entry point.');
}

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

function checkDist(bundle) {
  assert.ok(existsSync(distDirectory), 'Build directory does not exist: ' + distDirectory);
  const files = htmlFiles(distDirectory);
  assert.ok(files.length, 'Build directory contains no HTML.');
  const documentFiles = new Set();
  for (const definition of serviceLegal.documents) {
    const base = join(distDirectory, 'legal', definition.id);
    const generated = [join(base, 'index.html'), base + '.html'].filter(existsSync);
    if (bundle.mode === 'disabled') {
      assert.equal(generated.length, 0, 'Default build must not generate ' + definition.path);
      continue;
    }
    assert.equal(generated.length, 1, 'Expected one generated page for ' + definition.path);
    documentFiles.add(generated[0]);
    const html = readFileSync(generated[0], 'utf8');
    assert.ok(html.includes('data-service-legal-document="' + definition.id + '"'), 'Missing document identity.');
    assert.ok(html.includes('data-service-legal-version="' + serviceLegal.version + '"'), 'Missing document version.');
    assert.ok(html.includes('data-service-legal-mode="' + bundle.mode + '"'), 'Wrong publication mode.');
    assert.ok(html.includes('data-service-legal-order-access'), 'Order-specific document explanation missing.');
    if (bundle.mode === 'preview') {
      const robots = html.match(/<meta\b[^>]*name=["']robots["'][^>]*>/i)?.[0] ?? '';
      assert.match(robots, /content=["']noindex,\s*nofollow["']/i, 'Preview must not be indexed or followed.');
      assert.ok(html.includes('data-service-legal-preview'), 'Preview must be labelled as a draft.');
      assert.ok(html.includes('data-my-terms-unavailable'), 'Preview must explain unavailable participant entry point.');
      assert.ok(!html.includes('data-my-terms-link'), 'Preview must not invent an authorized entry point.');
    } else {
      assert.ok(html.includes('href="' + bundle.release.publication.myTermsUrl + '"'), 'Shared My Terms entry point missing.');
    }
  }

  const escapedOrigin = serviceLegal.origin.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  const serviceLink = new RegExp("href\\s*=\\s*[\"'](?:" + escapedOrigin + ")?/legal/(?:terms|privacy|withdrawal)(?:/|[\"'?#])", 'i');
  if (bundle.mode !== 'published') {
    for (const file of files) {
      if (documentFiles.has(file)) continue;
      const html = readFileSync(file, 'utf8');
      assert.ok(!serviceLink.test(html), 'Unpublished service link leaked into ' + file);
      assert.ok(!html.includes('data-service-legal-document='), 'Unpublished document leaked into ' + file);
      assert.ok(!html.includes('data-my-terms-link'), 'Unpublished participant entry point leaked into ' + file);
    }
  } else {
    const home = readFileSync(join(distDirectory, 'index.html'), 'utf8');
    for (const definition of serviceLegal.documents) {
      assert.ok(home.includes('href="' + definition.path + '"'), 'Published footer link missing: ' + definition.path);
    }
    assert.ok(home.includes('href="' + bundle.release.publication.myTermsUrl + '"'), 'Published My Terms footer link missing.');
    const participantPolicy = readFileSync(join(distDirectory, 'legal', 'privacy', 'index.html'), 'utf8');
    assert.ok(participantPolicy.includes('href="/privacy-policy/"'), 'Participant policy must link to the separate visitor policy.');
    const visitorPolicy = readFileSync(join(distDirectory, 'privacy-policy', 'index.html'), 'utf8');
    assert.ok(!visitorPolicy.includes('data-service-legal-document='), 'Participant documents must not replace the visitor policy.');
  }
  console.log('Service legal output check passed for ' + bundle.mode + ': ' + files.length + ' HTML files checked.');
}

try {
  if (selfTest) verifyGate();
  const bundle = loadServiceLegalBundle({
    registry: forceRelease ? { ...serviceLegal, enabled: true } : serviceLegal,
    preview: forceRelease ? false : process.env.LEGAL_PREVIEW === '1',
  });
  if (distDirectory) checkDist(bundle);
  console.log('Service legal mode: ' + bundle.mode + '; documents: ' + bundle.documents.length + '.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
