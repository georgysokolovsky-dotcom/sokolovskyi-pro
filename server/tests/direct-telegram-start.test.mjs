import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createApp } from '../src/http/app.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { createCorrelationHmac, createCorrelationToken, WEBINARSTARS_CORRELATION_CONTRACT } from '../src/webinarstars/correlation.mjs';

const signingSecret = 'direct-start-signing-fixture';
const correlationSecret = 'direct-start-correlation-fixture';
const webhookSecret = 'direct-start-webhook-fixture';
const config = {
  correlationSecret, webinarId: '31195', registrationUrl: 'https://provider.invalid/webinar/fixture/',
  scheduledStart: '2026-09-17T16:00:00Z', scheduledEnd: '2026-09-17T17:31:00Z', pollOffsetsMinutes: [0, 1, 3, 5, 10, 15],
};

test('plain /start uses direct attribution, persistent operation contract and stable WebinarStars correlation', async (t) => {
  const store = new MemoryStore();
  store.seed(localFixture);
  const sent = [];
  const flow = createMenWebinarFlow({
    store, signingSecret, botUsername: 'staging_fixture_bot',
    experienceProvider: createWebinarStarsExperienceProvider({ store, config }),
    transport: { async sendMessage(payload) {
      sent.push(payload);
      return { provider: 'fake', messageId: `fake-${sent.length}` };
    } },
  });
  const app = createApp({ flow, mode: 'staging', webhookSecret, allowedTelegramUserId: '123456789' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  async function webhook(id, text, updateId) {
    const response = await fetch(`${base}/v1/webhooks/telegram`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookSecret },
      body: JSON.stringify({ update_id: updateId, message: { from: { id }, text } }),
    });
    return { status: response.status, body: await response.json() };
  }

  const ignored = await webhook(999999999, '/start', 10);
  assert.deepEqual(ignored, { status: 200, body: { ok: true, ignored: true } });
  assert.equal(store.users.size, 0);
  assert.equal(sent.length, 0);

  const unknown = await webhook(123456789, '/start unknown_campaign', 11);
  assert.equal(unknown.status, 404);
  assert.equal(store.users.size, 0);

  const first = await webhook(123456789, '/start', 12);
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, false);
  assert.deepEqual([first.body.noticeStatus, first.body.bonusStatus, first.body.webinarInviteStatus], ['sent', 'sent', 'sent']);
  const user = store.findUserByTelegramId(123456789);
  assert.ok(user);
  assert.equal(store.users.size, 1);
  assert.equal(store.telegramUsers.size, 1);
  const touch = user.firstTouch;
  assert.deepEqual({ source: touch.source, medium: touch.medium, campaign: touch.campaign, content: touch.content,
    articleSlug: touch.articleSlug, startParameter: touch.startParameter },
  { source: 'direct', medium: 'direct', campaign: 'men_webinar', content: 'telegram_start', articleSlug: null, startParameter: 'direct_men_webinar' });
  assert.deepEqual(user.funnelEntryTouch, touch);
  assert.equal(store.getTelegramUpdate(user.funnelId, 12).status, 'completed');
  assert.equal(store.listUserEvents(user.id).filter((item) => item.eventType === 'telegram_start').length, 1);
  const allOperations = store.listDeliveryOperations({ userId: user.id });
  assert.equal(allOperations.filter((item) => item.messageType === 'warming').length, 0);
  const operations = allOperations.filter((item) => ['entry_notice', 'bonus', 'webinar_invite'].includes(item.messageType));
  assert.deepEqual(operations.map((item) => item.messageType), ['entry_notice', 'bonus', 'webinar_invite']);
  assert.ok(operations.every((item) => item.status === 'delivered' && item.attemptCount === 1 && item.providerMessageId));
  assert.deepEqual(sent.map((item) => item.message.role), ['entry_notice', 'bonus', 'webinar_invite']);

  const invite = sent[2].message.buttons[0].url;
  const url = new URL(invite);
  assert.equal(url.origin + url.pathname, config.registrationUrl);
  assert.equal(url.searchParams.get('utm_source'), 'telegram');
  assert.equal(url.searchParams.get('utm_medium'), 'bot');
  assert.equal(url.searchParams.get('utm_campaign'), 'men_webinar_v1');
  const token = url.searchParams.get('utm_content');
  assert.equal(token, createCorrelationToken(user.id, correlationSecret));
  const correlation = store.findProviderCorrelation({ provider: 'webinarstars', correlationHmac: createCorrelationHmac(token, correlationSecret) });
  assert.equal(correlation.contractVersion, WEBINARSTARS_CORRELATION_CONTRACT);
  assert.equal(correlation.funnelEntryId, user.id);
  assert.equal(store.providerSessionEntries.size, 1);
  assert.equal(store.listDeliveryOperations({ userId: user.id }).filter((item) => item.messageType === 'warming').length, 0);

  const repeat = await webhook(123456789, '/start', 12);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.duplicate, true);
  assert.equal(store.users.size, 1);
  assert.equal(store.telegramUpdates.size, 1);
  assert.equal(store.listDeliveryOperations({ userId: user.id }).length, allOperations.length);
  assert.equal(store.listUserEvents(user.id).filter((item) => item.eventType === 'telegram_start').length, 1);
  assert.equal(store.providerCorrelations.size, 1);
  assert.equal(sent.length, 3);

  const parameterizedApp = createApp({ flow, mode: 'staging', webhookSecret, allowedTelegramUserId: '234567891' });
  await new Promise((resolve) => parameterizedApp.listen(0, '127.0.0.1', resolve));
  t.after(() => parameterizedApp.close());
  const parameterized = await fetch(`http://127.0.0.1:${parameterizedApp.address().port}/v1/webhooks/telegram`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookSecret },
    body: JSON.stringify({ update_id: 13, message: { from: { id: 234567891 }, text: '/start article_wife_cheating' } }),
  });
  assert.equal(parameterized.status, 200);
  assert.equal((await parameterized.json()).duplicate, false);
  assert.equal(store.findUserByTelegramId(234567891).firstTouch.source, 'google');
  assert.equal(store.users.size, 2);
});

test('WebinarStars scheduler cancels a legacy internal reminder without sending', async () => {
  const store = new MemoryStore({ now: () => new Date('2026-09-18T12:00:00Z') });
  store.seed(localFixture);
  const user = store.createUser({ funnelId: localFixture.funnel.id, funnelEntryTouch: { source: 'test' } });
  const rule = localFixture.automationRules.find((item) => item.name === 'webinar_reminder_15m');
  const operation = store.createScheduledDeliveryOperation({
    operationKey: 'legacy-provider-boundary', funnelId: user.funnelId, userId: user.id,
    telegramChatId: 'fixture', warmingRuleId: rule.id, messageClass: rule.messageClass,
    funnelEntryKey: user.id, scheduledFor: '2026-09-18T11:00:00Z', earliestExecutionAt: '2026-09-18T11:00:00Z',
    descriptor: { ruleName: rule.name, templateName: rule.actionConfig.templateName },
  });
  let sends = 0;
  const flow = createMenWebinarFlow({ store, signingSecret, experienceProvider: createWebinarStarsExperienceProvider({ store, config }),
    transport: { async sendMessage() { sends += 1; throw new Error('must_not_send'); } },
    schedulerOptions: { now: () => new Date('2026-09-18T12:00:00Z') },
  });
  await flow.runWarmingScheduler();
  assert.equal(store.getDeliveryOperation(operation.id).status, 'cancelled');
  assert.equal(store.getDeliveryOperation(operation.id).cancellationReason, 'webinarstars_legacy_warming');
  assert.equal(sends, 0);
});
