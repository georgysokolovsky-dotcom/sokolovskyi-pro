import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';
import { resolveDailyWebinarStarsSession } from '../src/webinarstars/daily-session.mjs';
import { createApp } from '../src/http/app.mjs';
import { guardTelegramOutbound } from '../src/telegram/outbound-guard.mjs';
import { APPROVED_WEBINARSTARS_FOLLOW_UP_TEMPLATES } from '../src/config/webinarstars-follow-up-templates.mjs';

const production = {
  FUNNEL_MODE: 'production', FUNNEL_STORE: 'postgres', TELEGRAM_TRANSPORT: 'bot-api',
  WEBINAR_EXPERIENCE_PROVIDER: 'webinarstars', DATABASE_URL: 'postgresql://db.example.invalid/men_funnel_production',
  TOKEN_SIGNING_SECRET: 'test-signing', TELEGRAM_WEBHOOK_SECRET: 'test-webhook',
  TELEGRAM_BOT_TOKEN: 'test-bot-token', TELEGRAM_BOT_API_BASE_URL: 'https://api.telegram.org',
  TELEGRAM_EXPECTED_BOT_USERNAME: 'sokolovskyi_men_bot',
  TELEGRAM_WEBHOOK_URL: 'https://men.example.invalid/v1/webhooks/telegram',
  PUBLIC_APPLICATION_ORIGIN: 'https://men.example.invalid',
  PRIVACY_POLICY_URL: 'https://example.invalid/privacy-policy/', APPLICATION_CONSENT_VERSION: 'men_application_v1',
  APPLICATION_CONSENT_TEXT: 'Test consent for automated checks',
  WEBINARSTARS_API_BASE_URL: 'https://efir.webinar-stars.com', WEBINARSTARS_API_TOKEN: 'test-api',
  WEBINARSTARS_CORRELATION_SECRET: 'test-correlation', WEBINARSTARS_WEBINAR_ID: '31195',
  WEBINARSTARS_REGISTRATION_URL: 'https://efir.webinar-stars.com/webinar/5071c97bc4cfde5/',
  WEBINARSTARS_TIME_ZONE: 'Europe/Kiev',
};

test('production config fails closed and never inherits staging identity or static schedule', () => {
  for (const name of ['DATABASE_URL', 'PUBLIC_APPLICATION_ORIGIN', 'PRIVACY_POLICY_URL', 'APPLICATION_CONSENT_VERSION', 'APPLICATION_CONSENT_TEXT']) {
    const broken = { ...production }; delete broken[name];
    assert.throws(() => loadRuntimeConfig(broken), new RegExp(name));
  }
  const config = loadRuntimeConfig(production);
  assert.equal(config.mode, 'production');
  assert.equal(config.allowedTelegramUserId, null);
  assert.equal(config.telegramOutboundEnabled, false);
  assert.equal(config.webinarStarsSyncEnabled, false);
  assert.equal(config.webinarStarsFollowUpEnabled, false);
  assert.equal(config.adminApiEnabled, false);
  assert.equal(config.webinarStars.scheduleMode, 'daily');
  assert.equal(config.webinarStars.scheduledStart, null);
  assert.deepEqual(config.databasePoolOptions.ssl, { rejectUnauthorized: true });
  assert.throws(() => loadRuntimeConfig({ ...production, DATABASE_SSL_MODE: 'disable' }), /DATABASE_SSL_MODE/);
  assert.throws(() => loadRuntimeConfig({ ...production, DATABASE_URL: 'postgresql:\/\/db.invalid\/men_funnel_staging_e2e' }), /separate database/);
  assert.throws(() => loadRuntimeConfig({ ...production, STAGING_ALLOWED_TELEGRAM_USER_ID: '123456789' }), /Staging identity/);
  assert.throws(() => loadRuntimeConfig({ ...production, TELEGRAM_EXPECTED_BOT_USERNAME: 'sokolovskyi_men_stage_bot' }), /bot username/);
  assert.throws(() => loadRuntimeConfig({ ...production, TELEGRAM_BOT_USERNAME: 'sokolovskyi_men_stage_bot' }), /bot username/);
  assert.throws(() => loadRuntimeConfig({ ...production, WEBINARSTARS_REGISTRATION_URL: 'https://example.invalid/webinar' }), /registration URL/);
  assert.throws(() => loadRuntimeConfig({ ...production, TELEGRAM_WEBHOOK_URL: 'https://old.trycloudflare.com/v1/webhooks/telegram' }), /Quick Tunnel/);
  assert.throws(() => loadRuntimeConfig({ ...production, APPLICATION_CONSENT_VERSION: 'men_application_staging_v1' }), /CONSENT_VERSION/);
  assert.throws(() => loadRuntimeConfig({ ...production, ADMIN_API_ENABLED: 'true' }), /admin API/);
  assert.throws(() => loadRuntimeConfig({ ...production, TELEGRAM_OUTBOUND_ENABLED: 'true' }), /canary or explicit traffic/);
  assert.throws(() => loadRuntimeConfig({ ...production, PRODUCTION_CANARY_ENABLED: 'true' }), /PRODUCTION_CANARY_ALLOWED/);
  const canary = loadRuntimeConfig({ ...production, PRODUCTION_CANARY_ENABLED: 'true',
    PRODUCTION_CANARY_ALLOWED_TELEGRAM_USER_ID: '123456789', TELEGRAM_OUTBOUND_ENABLED: 'true' });
  assert.equal(canary.allowedTelegramUserId, '123456789');
  assert.equal(canary.telegramOutboundEnabled, true);
});

test('daily WebinarStars session selects before/after 19:00, midnight and both DST boundaries', () => {
  const options = { timeZone: 'Europe/Kiev', localStart: '19:00', durationMinutes: 91 };
  const cases = [
    ['2026-09-18T12:00:00Z', '2026-09-18T16:00:00.000Z'],
    ['2026-09-18T16:00:00Z', '2026-09-19T16:00:00.000Z'],
    ['2026-09-18T22:30:00Z', '2026-09-19T16:00:00.000Z'],
    ['2026-03-28T12:00:00Z', '2026-03-28T17:00:00.000Z'],
    ['2026-03-29T12:00:00Z', '2026-03-29T16:00:00.000Z'],
    ['2026-10-24T12:00:00Z', '2026-10-24T16:00:00.000Z'],
    ['2026-10-25T12:00:00Z', '2026-10-25T17:00:00.000Z'],
  ];
  for (const [now, expected] of cases) {
    const session = resolveDailyWebinarStarsSession(now, options);
    assert.equal(session.scheduledStart, expected);
    assert.equal(new Date(session.scheduledEnd).getTime() - new Date(session.scheduledStart).getTime(), 91 * 60_000);
  }
});

test('production HTTP surface rejects test/admin routes and enforces canary before outbound', async (t) => {
  let starts = 0;
  const flow = {
    async handleTelegramStart() { starts += 1; return { duplicate: false, notice: { status: 'sent' },
      bonusDelivery: { status: 'sent' }, webinarInviteDelivery: { status: 'sent' } }; },
    async validateApplicationAccess() { return { submitted: false }; },
  };
  const app = createApp({ flow, mode: 'production', webhookSecret: 'hook', allowedTelegramUserId: '123456789',
    telegramOutboundEnabled: true, privacyPolicyUrl: 'https://example.invalid/privacy-policy/', applicationConsentVersion: 'men_application_v1', applicationConsentText: 'Test consent for automated checks' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(`${origin}/v1/test/telegram/start`, { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await fetch(`${origin}/v1/admin/dashboard`, { headers: { 'x-admin-local-key': 'hook' } })).status, 404);
  assert.equal((await fetch(`${origin}/v1/admin/leads/opaque`, { headers: { 'x-admin-local-key': 'hook' } })).status, 404);
  const webhook = (id) => fetch(`${origin}/v1/webhooks/telegram`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook' },
    body: JSON.stringify({ update_id: id, message: { from: { id }, text: '/start' } }) });
  assert.equal((await webhook(999999999)).status, 200);
  assert.equal(starts, 0);
  assert.equal((await webhook(123456789)).status, 200);
  assert.equal(starts, 1);
  const page = await fetch(`${origin}/application?t=opaque`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-consent-version="men_application_v1"/);
  assert.match(html, /Test consent for automated checks/);
  const disabled = createApp({ flow, mode: 'production', webhookSecret: 'hook', allowedTelegramUserId: '123456789',
    telegramOutboundEnabled: false, privacyPolicyUrl: 'https://example.invalid/privacy-policy/', applicationConsentVersion: 'men_application_v1', applicationConsentText: 'Test consent for automated checks' });
  await new Promise((resolve) => disabled.listen(0, '127.0.0.1', resolve));
  t.after(() => disabled.close());
  assert.equal((await fetch(`http://127.0.0.1:${disabled.address().port}/v1/webhooks/telegram`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook' },
    body: JSON.stringify({ update_id: 4, message: { from: { id: 123456789 }, text: '/start' } }) })).status, 503);
  assert.equal(starts, 1);
});

test('Telegram outbound and follow-up remain separately gated', async () => {
  let calls = 0;
  const transport = { async sendMessage() { calls += 1; return { provider: 'fake', messageId: '1' }; } };
  await assert.rejects(guardTelegramOutbound(transport, { enabled: false }).sendMessage({ telegramChatId: '1' }), /disabled/);
  await assert.rejects(guardTelegramOutbound(transport, { enabled: true, allowedTelegramUserId: '123' }).sendMessage({ telegramChatId: '999' }), /not_allowed/);
  assert.equal(calls, 0);
  assert.equal(loadRuntimeConfig(production).webinarStarsFollowUpEnabled, false);
  const active = loadRuntimeConfig({ ...production, PRODUCTION_CANARY_ENABLED: 'true', PRODUCTION_CANARY_ALLOWED_TELEGRAM_USER_ID: '123456789',
    TELEGRAM_OUTBOUND_ENABLED: 'true', WEBINARSTARS_FOLLOWUP_ENABLED: 'true' });
  assert.equal(active.webinarStarsFollowUpEnabled, true);
  assert.deepEqual(Object.values(APPROVED_WEBINARSTARS_FOLLOW_UP_TEMPLATES).map((item) => item.templateId),
    ['ws_no_show_v1', 'ws_left_before_offer_v1', 'ws_offer_unseen_v1', 'ws_cta_seen_v1', 'ws_cta_clicked_v1']);
});
