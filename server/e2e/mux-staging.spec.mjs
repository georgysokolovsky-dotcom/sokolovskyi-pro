import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createDevTelegramTransport } from '../src/telegram/transport.mjs';
import { createApp } from '../src/http/app.mjs';
import { createMuxMediaSource, normalizeMuxPrivateKey, signMuxPlaybackJwt } from '../src/webinar/providers/mux-media-source.mjs';
import { signFunnelToken, verifyFunnelToken } from '../src/security/signed-tokens.mjs';

const { Pool } = pg;
const signingSecret = 'mux-staging-browser-signing-secret';
const fixtureVideoId = localFixture.webinar.videoId;

function requireEnvironment() {
  const names = ['FUNNEL_TEST_DATABASE_URL', 'MUX_SIGNING_KEY_ID', 'MUX_SIGNING_PRIVATE_KEY', 'MUX_PLAYBACK_ID'];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required Mux staging environment: ${missing.join(', ')}`);
}

test.describe.serial('real Mux signed playback in isolated MEN staging', () => {
  let admin;
  let pool;
  let store;
  let flow;
  let app;
  let localPort;
  let browserOrigin;
  let playbackSourceProvider;
  let telegramId = 91_000;

  async function listen(port) {
    app = createApp({ flow, mode: 'staging', webhookSecret: 'mux-browser-webhook', adminKey: 'mux-browser-admin' });
    await new Promise((resolve) => app.listen(port, '127.0.0.1', resolve));
    localPort = app.address().port;
  }

  function buildFlow() {
    return createMenWebinarFlow({
      store, signingSecret, botUsername: localFixture.telegramBotUsername,
      applicationReference: '/application', webinarBaseUrl: 'http://127.0.0.1/webinar',
      entryNotice: localFixture.entryNotice, transport: createDevTelegramTransport(), playbackSourceProvider,
      schedulerOptions: { random: () => 0 },
    });
  }

  test.beforeAll(async () => {
    requireEnvironment();
    const connectionString = process.env.FUNNEL_TEST_DATABASE_URL;
    const schema = `men_mux_${randomUUID().replaceAll('-', '')}`;
    admin = new Pool({ connectionString, max: 2 });
    await admin.query(`create schema ${schema}`);
    pool = new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
    for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
      await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    store = new PostgresStore({ pool });
    await store.seed(localFixture);
    playbackSourceProvider = createMuxMediaSource({
      keyId: process.env.MUX_SIGNING_KEY_ID,
      privateKey: process.env.MUX_SIGNING_PRIVATE_KEY,
      playbackId: process.env.MUX_PLAYBACK_ID,
      tokenTtlSeconds: 3600,
      playbackBufferSeconds: 600,
    });
    flow = buildFlow();
    const requestedPort = Number(process.env.FUNNEL_E2E_PORT || 0);
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) throw new Error('FUNNEL_E2E_PORT is invalid');
    await listen(requestedPort);
    browserOrigin = (process.env.FUNNEL_E2E_ORIGIN || `http://127.0.0.1:${localPort}`).replace(/\/+$/, '');
  });

  test.afterAll(async () => {
    if (app) await new Promise((resolve) => app.close(resolve));
    if (pool) {
      const schema = (await pool.query('select current_schema() as name')).rows[0].name;
      await pool.end();
      await admin.query(`drop schema if exists ${schema} cascade`);
    }
    if (admin) await admin.end();
  });

  async function startUser() {
    telegramId += 1;
    return flow.handleTelegramStart({
      telegramUserId: telegramId, startParameter: 'article_wife_cheating', updateId: telegramId,
      timestamp: new Date().toISOString(),
    });
  }

  const eventTypes = async (userId) => (await store.listUserEvents(userId)).map((event) => event.eventType);

  test('Chrome plays real signed HLS, persists progress through restart and reaches application', async ({ page }) => {
    const network = [];
    const failedRequests = [];
    const responseFailures = [];
    const consoleErrors = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      const resource = url.pathname.endsWith('.m3u8') ? 'manifest' : url.pathname.endsWith('.m4s') ? 'segment' : 'document-or-script';
      network.push({ origin: url.origin, resource, hasToken: url.searchParams.has('token') });
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().replace(/https?:\/\/\S+/g, '[redacted-url]'));
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message.replace(/https?:\/\/\S+/g, '[redacted-url]')));
    page.on('requestfailed', (request) => failedRequests.push({ origin: new URL(request.url()).origin, error: request.failure()?.errorText }));
    page.on('response', (response) => {
      if (response.status() >= 400) responseFailures.push({ origin: new URL(response.url()).origin, status: response.status() });
    });

    const started = await startUser();
    const pagePath = `/webinar/${fixtureVideoId}?t=${encodeURIComponent(started.webinar.token)}`;
    const navigation = await page.goto(`${browserOrigin}${pagePath}`);
    expect(navigation.status()).toBe(200);
    await expect(page.locator('[data-webinar-root]')).toHaveAttribute('data-video-provider', 'mux-hls');
    const html = await page.content();
    expect(html).not.toContain(process.env.MUX_SIGNING_PRIVATE_KEY.slice(0, 40));
    expect(html).not.toContain(process.env.MUX_SIGNING_KEY_ID);

    const video = page.locator('video');
    try {
      await expect.poll(async () => video.evaluate((element) => element.readyState >= 1 && Number.isFinite(element.duration)), {
        timeout: 30_000,
      }).toBe(true);
    } catch {
      const playerState = await page.evaluate(() => ({
        hlsType: typeof globalThis.Hls,
        hlsSupported: globalThis.Hls?.isSupported?.() ?? null,
        readyState: document.querySelector('video')?.readyState,
        mediaError: document.querySelector('video')?.error?.code ?? null,
        scripts: [...document.scripts].map((script) => new URL(script.src).pathname),
      }));
      throw new Error(JSON.stringify({ playerState, network, consoleErrors, failedRequests, responseFailures }));
    }
    const metadataState = await video.evaluate((element) => ({ readyState: element.readyState, duration: element.duration }));
    expect(metadataState.readyState, JSON.stringify({ consoleErrors, failedRequests, responseFailures })).toBeGreaterThanOrEqual(1);
    const duration = await video.evaluate((element) => element.duration);
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThan(120);
    await pool.query('update webinars set duration_seconds=$1 where id=$2', [duration, localFixture.webinar.id]);
    await video.evaluate((element) => element.play());
    await expect.poll(() => eventTypes(started.userId)).toContain('webinar_started');
    await expect.poll(() => eventTypes(started.userId), { timeout: Math.ceil(duration * 1000) + 60_000 }).toContain('webinar_completed');
    for (const eventType of ['watched_25', 'watched_50', 'watched_75', 'watched_90', 'watched_100']) {
      expect((await eventTypes(started.userId)).filter((item) => item === eventType)).toHaveLength(1);
    }
    await page.screenshot({ path: '/tmp/men-funnel-mux-staging.png', fullPage: false });

    const muxRequests = network.filter((request) => request.origin.endsWith('.mux.com') || request.origin === 'https://stream.mux.com');
    expect(muxRequests.some((request) => request.resource === 'manifest' && request.hasToken)).toBe(true);
    expect(network.every((request) => {
      const origin = new URL(browserOrigin).origin;
      return request.origin === origin || request.origin === 'https://stream.mux.com' || request.origin.endsWith('.mux.com');
    })).toBe(true);
    expect(network.some((request) => request.origin.includes('litix.io'))).toBe(false);
    expect(consoleErrors).toEqual([]);

    await new Promise((resolve) => app.close(resolve));
    flow = buildFlow();
    await listen(localPort);
    await page.reload();
    await expect(page.locator('video')).toBeVisible();
    for (const eventType of ['webinar_started', 'watched_25', 'watched_50', 'watched_75', 'watched_90', 'watched_100', 'webinar_completed']) {
      expect((await eventTypes(started.userId)).filter((item) => item === eventType)).toHaveLength(1);
    }

    const findFollowUp = async () => (await store.listDeliveryOperations({ userId: started.userId }))
      .find((operation) => operation.descriptor?.ruleName === 'application_follow_up_2h');
    await expect.poll(findFollowUp).toMatchObject({ status: 'scheduled' });
    const followUp = await findFollowUp();
    expect(followUp.status).toBe('scheduled');
    await page.route(/\/application\?t=/, (route) => route.fulfill({
      status: 200, contentType: 'text/html', body: '<!doctype html><link rel="icon" href="data:"><title>Application flow</title><h1>Application flow</h1>',
    }));
    await page.getByRole('button', { name: 'Перейти к заявке' }).click();
    await page.waitForURL(/\/application\?t=/);
    const applicationToken = new URL(page.url()).searchParams.get('t');
    expect(verifyFunnelToken(applicationToken, { purpose: 'application', secret: signingSecret }).ok).toBe(true);
    expect((await store.getDeliveryOperation(followUp.id)).status).toBe('cancelled');
  });

  test('Mux and MEN authorization reject unsigned, wrong and expired tokens', async ({ page }) => {
    const privateKey = normalizeMuxPrivateKey(process.env.MUX_SIGNING_PRIVATE_KEY);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const makeUrl = (token) => `https://stream.mux.com/${encodeURIComponent(process.env.MUX_PLAYBACK_ID)}.m3u8${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const candidates = [
      ['unsigned', makeUrl(null)],
      ['wrong-sub', makeUrl(signMuxPlaybackJwt({ keyId: process.env.MUX_SIGNING_KEY_ID, privateKey, playbackId: 'WrongPlayback123', expiresAt: nowSeconds + 300 }))],
      ['wrong-aud', makeUrl(signMuxPlaybackJwt({ keyId: process.env.MUX_SIGNING_KEY_ID, privateKey, playbackId: process.env.MUX_PLAYBACK_ID, audience: 't', expiresAt: nowSeconds + 300 }))],
      ['expired', makeUrl(signMuxPlaybackJwt({ keyId: process.env.MUX_SIGNING_KEY_ID, privateKey, playbackId: process.env.MUX_PLAYBACK_ID, expiresAt: nowSeconds - 60 }))],
    ];
    const results = [];
    for (const [label, url] of candidates) {
      try { results.push({ label, status: (await fetch(url, { redirect: 'manual' })).status }); }
      catch { results.push({ label, status: 'network_error' }); }
    }
    expect(results.map(({ label, status }) => ({ label, rejected: typeof status === 'number' && status >= 400 })))
      .toEqual(candidates.map(([label]) => ({ label, rejected: true })));

    const started = await startUser();
    const now = Date.now();
    const invalidMenTokens = [
      signFunnelToken({ purpose: 'application', userRef: started.userId, funnelId: started.funnelId, secret: signingSecret, now: () => now }),
      signFunnelToken({ purpose: 'webinar', userRef: started.userId, funnelId: started.funnelId, ttlSeconds: 60, secret: signingSecret, now: () => now - 120_000 }),
    ];
    await page.goto(`${browserOrigin}/health`);
    const statuses = await page.evaluate(async ({ videoId, tokens }) => {
      const output = [];
      for (const token of tokens) output.push((await fetch(`/webinar/${videoId}?t=${encodeURIComponent(token)}`)).status);
      return output;
    }, { videoId: fixtureVideoId, tokens: invalidMenTokens });
    expect(statuses).toEqual([401, 401]);
  });
});
