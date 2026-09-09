import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';

test('memory store implements the persistent store Telegram claim contract', async () => {
  const store = new MemoryStore();
  await store.seed(localFixture);
  const source = await store.findSourceByStartParameter('men_webinar_v1', 'article_wife_cheating');
  const touch = { sourceId: source.id, source: source.source, medium: source.medium, campaign: source.campaign, content: source.content, articleSlug: source.articleSlug, startParameter: source.startParameter, occurredAt: '2026-09-10T10:00:00.000Z' };
  const claim = await store.claimTelegramStart({ source, telegramUserId: 1001, telegramChatId: 1001, firstName: 'Test', username: null, languageCode: 'ru', firstTouch: touch, funnelEntryTouch: touch, eventMetadata: { source_id: source.id }, eventKey: 'telegram-update:123', updateId: 123, occurredAt: touch.occurredAt });
  assert.equal((await store.getTelegramUpdate(source.funnelId, 123)).status, 'processing');
  await store.finishTelegramUpdate({ funnelId: source.funnelId, updateId: 123, status: 'completed' });
  const duplicate = await store.claimTelegramStart({ source, telegramUserId: 9999, telegramChatId: 9999, firstName: 'Duplicate', username: null, languageCode: 'ru', firstTouch: touch, funnelEntryTouch: touch, eventMetadata: { source_id: source.id }, eventKey: 'telegram-update:123', updateId: 123, occurredAt: touch.occurredAt });

  assert.equal(claim.duplicate, false);
  assert.equal((await store.getTelegramUpdate(source.funnelId, 123)).status, 'completed');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.user.id, claim.user.id);
  assert.equal(store.users.size, 1);
  assert.equal((await store.getTelegramUser(claim.user.id)).telegramChatId, '1001');
  assert.equal((await store.listUserEvents(claim.user.id)).filter((event) => event.eventType === 'telegram_start').length, 1);
});
