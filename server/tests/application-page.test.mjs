import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createMenApplicationUrlProvider } from '../src/application/access-url.mjs';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { signFunnelToken } from '../src/security/signed-tokens.mjs';

test('purpose-bound application page validates token and submits allowlist to store', async (t) => {
  const store = new MemoryStore();
  store.seed(localFixture);
  const flow = createMenWebinarFlow({ store, signingSecret: 'page-test-secret', botUsername: 'test_bot' });
  const server = createApp({ flow, mode: 'staging', webhookSecret: 'webhook-secret', allowedTelegramUserId: '123456789',
    privacyPolicyUrl: 'https://example.invalid/privacy-policy/', applicationConsentVersion: 'men_application_privacy_v1_2026_09_20',
    applicationConsentText: 'Я ознакомился с Политикой конфиденциальности.' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const invalid = await fetch(`${origin}/application?t=bogus`);
  assert.equal(invalid.status, 401);
  assert.match(await invalid.text(), /Ссылка недоступна/);
  const rejected = await fetch(`${origin}/v1/webhooks/telegram`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'webhook-secret' }, body: JSON.stringify({ update_id: 7, message: { from: { id: 999999999 }, text: '/start' } }) });
  assert.deepEqual(await rejected.json(), { ok: true, ignored: true });
  const started = await flow.handleTelegramStart({ telegramUserId: 123456789, startParameter: 'article_wife_cheating' });
  const user = await store.getUser(started.userId);
  const provider = createMenApplicationUrlProvider({ signingSecret: 'page-test-secret', applicationReference: `${origin}/application` });
  const access = provider.createApplicationUrl({ user });
  const page = await fetch(access.url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /name="name"/);
  assert.match(html, /name="phone"/);
  assert.match(html, /type="tel"/);
  assert.match(html, /Записаться на разбор/);
  assert.match(html, /Данные используются для рассмотрения заявки и связи с вами\./);
  assert.match(html, /href="https:\/\/example\.invalid\/privacy-policy\/"[^>]*>Политикой конфиденциальности<\/a>/);
  assert.doesNotMatch(html, /name="situation"/);
  assert.doesNotMatch(html, /name="email"/);
  assert.doesNotMatch(html, new RegExp(access.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const submit = (answers, token = access.token) => fetch(`${origin}/v1/applications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, answers, consent: { accepted: true, policyVersion: 'test-v1', source: 'test' } }) });
  assert.equal((await submit({ name: '', phone: '+34 612 345 678' })).status, 400);
  assert.equal((await submit({ name: 'Тест', phone: '' })).status, 400);
  assert.equal((await submit({ name: 'Тест', phone: 'not-a-phone' })).status, 400);
  assert.equal((await submit({ name: 'Тест', phone: '+34 612 345 678', situation: 'Не принимать' })).status, 400);
  assert.equal((await submit({ name: 'Тест', phone: '+34 612 345 678', email: 'ignored@example.com' })).status, 400);
  const expired = signFunnelToken({ purpose: 'application', userRef: user.id, funnelId: user.funnelId, ttlSeconds: 60,
    secret: 'page-test-secret', now: () => Date.now() - 120_000 });
  assert.equal((await submit({ name: 'Тест', phone: '+34612345678' }, expired)).status, 401);
  const submission = await submit({ name: 'Тест', phone: '+34 (612) 345-678' });
  assert.equal(submission.status, 201);
  assert.deepEqual((await store.getApplicationForUser(user.id)).answers, { name: 'Тест', phone: '+34612345678' });
  assert.match(await (await fetch(access.url)).text(), /Заявка уже отправлена/);
  const duplicate = await submit({ name: 'Другое имя', phone: '0501234567' });
  assert.equal(duplicate.status, 200);
  assert.deepEqual((await store.getApplicationForUser(user.id)).answers, { name: 'Тест', phone: '+34612345678' });
});
