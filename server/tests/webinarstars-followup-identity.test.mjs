import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localFixture } from '../src/data/local-fixture.mjs';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { guardTelegramOutbound } from '../src/telegram/outbound-guard.mjs';
import { APPROVED_WEBINARSTARS_FOLLOW_UP_TEMPLATES } from '../src/config/webinarstars-follow-up-templates.mjs';
import { createWebinarStarsFollowUpScheduler } from '../src/webinarstars/lifecycle.mjs';

const dueAt = '2026-09-21T21:06:13.325Z';
const now = () => new Date('2026-09-21T21:07:00.000Z');

function fixture({ telegramUserId = '123456789', telegramChatId = '-100123456789', withTelegram = true,
  followUpUserId = null } = {}) {
  const store = new MemoryStore({ now });
  store.seed(localFixture);
  const user = store.createUser({ funnelId: localFixture.funnel.id });
  if (withTelegram) store.upsertTelegramUser({ userId: user.id, telegramUserId, telegramChatId });
  store.scheduleProviderFollowUp({
    id: randomUUID(), decisionId: randomUUID(), funnelEntryId: user.id, reportId: 'production-canary-report',
    funnelId: user.funnelId, userId: followUpUserId ?? user.id, segment: 'LEFT_BEFORE_OFFER',
    followUpRule: 'ws_left_before_offer_60m_v1', templateId: 'ws_left_before_offer_v1', scheduledFor: dueAt,
  });
  return { store, user, telegramUserId, telegramChatId };
}

function scheduler({ store, transport, allowedTelegramUserId = null, workerId = randomUUID(), applicationUrlProvider = null }) {
  return createWebinarStarsFollowUpScheduler({
    store, config: {}, workerId, now,
    allowedTelegramUserId,
    templates: APPROVED_WEBINARSTARS_FOLLOW_UP_TEMPLATES,
    experienceProvider: { async createExperienceUrl() { return { url: 'https://provider.invalid/next' }; } },
    applicationUrlProvider,
    transport,
  });
}

test('canary resolves internal user through funnel entry and authorizes the external Telegram identity', async () => {
  const { store, user, telegramUserId, telegramChatId } = fixture();
  const claimedWith = [];
  const resolvedUsers = [];
  const claim = store.claimProviderFollowUp.bind(store);
  const getUser = store.getUser.bind(store);
  store.claimProviderFollowUp = (options) => { claimedWith.push(options); return claim(options); };
  store.getUser = (userId) => { resolvedUsers.push(userId); return getUser(userId); };
  const sent = [];
  const rawTransport = { provider: 'fake', async sendMessage(payload) {
    sent.push(payload); return { provider: 'fake', messageId: 'one' };
  } };
  const transport = guardTelegramOutbound(rawTransport, { enabled: true, allowedTelegramUserId: telegramUserId });
  const result = await scheduler({ store, transport, allowedTelegramUserId: telegramUserId, workerId: 'canary-match' }).run();
  assert.equal(result.delivered, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, user.id);
  assert.equal(sent[0].telegramUserId, telegramUserId);
  assert.equal(sent[0].telegramChatId, telegramChatId);
  assert.equal(resolvedUsers.length > 0, true);
  assert.equal(resolvedUsers.every((userId) => userId === user.id), true);
  assert.equal(claimedWith[0].userId, null);
  assert.equal((await scheduler({ store, transport, allowedTelegramUserId: telegramUserId, workerId: 'repeat' }).run()).claimed, 0);
  assert.equal(sent.length, 1);
});

test('canary mismatch never calls transport and leaves the follow-up recoverable', async () => {
  const { store } = fixture({ telegramUserId: '123456789' });
  let calls = 0;
  const result = await scheduler({ store, allowedTelegramUserId: '987654321', workerId: 'canary-mismatch',
    transport: { async sendMessage() { calls += 1; } } }).run();
  const followUp = store.listProviderFollowUps()[0];
  assert.equal(result.deferred, 1);
  assert.equal(calls, 0);
  assert.equal(followUp.status, 'scheduled');
  assert.equal(followUp.requestStartedAt, null);
  assert.equal(followUp.leaseOwner, null);
  assert.equal(followUp.providerMessageId, null);
});

test('missing Telegram identity never calls transport and leaves the follow-up recoverable', async () => {
  const { store } = fixture({ withTelegram: false });
  let calls = 0;
  const result = await scheduler({ store, allowedTelegramUserId: '123456789', workerId: 'missing-telegram',
    transport: { async sendMessage() { calls += 1; } } }).run();
  const followUp = store.listProviderFollowUps()[0];
  assert.equal(result.deferred, 1);
  assert.equal(calls, 0);
  assert.equal(followUp.status, 'scheduled');
  assert.equal(followUp.requestStartedAt, null);
});

test('follow-up user mismatch never substitutes the canary Telegram ID for an internal UUID', async () => {
  const { store } = fixture({ followUpUserId: randomUUID() });
  const claimArguments = [];
  const claim = store.claimProviderFollowUp.bind(store);
  store.claimProviderFollowUp = (options) => { claimArguments.push(options); return claim(options); };
  let calls = 0;
  const result = await scheduler({ store, allowedTelegramUserId: '123456789', workerId: 'identity-mismatch',
    transport: { async sendMessage() { calls += 1; } } }).run();
  assert.equal(result.deferred, 1);
  assert.equal(calls, 0);
  assert.equal(claimArguments[0].userId, null);
  assert.equal(store.listProviderFollowUps()[0].status, 'scheduled');
});

test('general traffic resolves the recipient from the follow-up without a canary allowlist', async () => {
  const { store, user, telegramUserId, telegramChatId } = fixture();
  const sent = [];
  const result = await scheduler({ store, workerId: 'general-traffic', transport: { async sendMessage(payload) {
    sent.push(payload); return { provider: 'fake', messageId: 'general-one' };
  } } }).run();
  assert.equal(result.delivered, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, user.id);
  assert.equal(sent[0].telegramUserId, telegramUserId);
  assert.equal(sent[0].telegramChatId, telegramChatId);
});
