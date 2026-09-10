import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createDevTelegramTransport } from '../src/telegram/transport.mjs';
import { createApp } from '../src/http/app.mjs';
import { signFunnelToken, verifyFunnelToken } from '../src/security/signed-tokens.mjs';

const { Pool } = pg;
const signingSecret = 'browser-e2e-signing-secret';
const fixtureVideoId = localFixture.webinar.videoId;

test.describe.serial('protected webinar browser flow', () => {
  let admin;
  let pool;
  let store;
  let flow;
  let app;
  let baseUrl;
  let browserOrigin;
  let schedulerClock;
  let nextTelegramId = 81_000;

  test.beforeAll(async () => {
    const connectionString = process.env.FUNNEL_TEST_DATABASE_URL;
    if (!connectionString) throw new Error('FUNNEL_TEST_DATABASE_URL is required for browser E2E');
    const schema = `men_browser_${randomUUID().replaceAll('-', '')}`;
    admin = new Pool({ connectionString, max: 2 });
    await admin.query(`create schema ${schema}`);
    pool = new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
    for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
      await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    store = new PostgresStore({ pool });
    await store.seed(localFixture);
    schedulerClock = { value: new Date() };
    flow = createMenWebinarFlow({
      store,
      signingSecret,
      botUsername: localFixture.telegramBotUsername,
      applicationReference: '/application',
      webinarBaseUrl: 'http://127.0.0.1/webinar',
      entryNotice: localFixture.entryNotice,
      transport: createDevTelegramTransport(),
      schedulerOptions: { now: () => schedulerClock.value, random: () => 0 },
    });
    app = createApp({ flow, mode: 'staging', webhookSecret: 'browser-e2e-webhook', adminKey: 'browser-e2e-admin' });
    const requestedPort = Number(process.env.FUNNEL_E2E_PORT || 0);
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) throw new Error('FUNNEL_E2E_PORT is invalid');
    await new Promise((resolve) => app.listen(requestedPort, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${app.address().port}`;
    browserOrigin = (process.env.FUNNEL_E2E_ORIGIN || baseUrl).replace(/\/+$/, '');
  });

  test.afterAll(async () => {
    if (app) await new Promise((resolve) => app.close(resolve));
    const schema = (await pool.query('select current_schema() as name')).rows[0].name;
    await pool.end();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });

  async function startUser() {
    nextTelegramId += 1;
    return flow.handleTelegramStart({
      telegramUserId: nextTelegramId,
      startParameter: 'article_wife_cheating',
      updateId: nextTelegramId,
      timestamp: new Date().toISOString(),
    });
  }

  const eventTypes = async (userId) => (await store.listUserEvents(userId)).map((event) => event.eventType);
  const operationByRule = async (userId, ruleName) => (await store.listDeliveryOperations({ userId }))
    .find((operation) => operation.descriptor?.ruleName === ruleName);

  test('real playback persists milestones, reconciles scheduler and reaches application flow', async ({ page, context }) => {
    const externalRequests = [];
    const consoleErrors = [];
    const failedLocalResponses = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(browserOrigin).origin) externalRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) failedLocalResponses.push({ status: response.status(), pathname: new URL(response.url()).pathname });
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push({ message: message.text(), pathname: message.location().url ? new URL(message.location().url).pathname : null });
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const started = await startUser();
    const webinarUrl = `${browserOrigin}/webinar/${fixtureVideoId}?t=${encodeURIComponent(started.webinar.token)}`;
    const mediaResponsePromise = page.waitForResponse((response) => response.url().includes('/v1/webinar/media/'));
    const navigation = await page.goto(webinarUrl);
    expect(navigation.status()).toBe(200);
    await expect(page).toHaveTitle(/Видеоразбор/);
    await expect(page.locator('[data-webinar-root]')).toBeVisible();
    await expect(page.locator('video')).toBeVisible();
    const mediaResponse = await mediaResponsePromise;
    expect([200, 206]).toContain(mediaResponse.status());
    const mediaUrl = new URL(mediaResponse.url());
    expect(mediaUrl.searchParams.has('mt')).toBe(true);
    expect(mediaUrl.searchParams.get('mt')).not.toBe(started.webinar.token);
    expect(mediaResponse.headers()['access-control-allow-origin']).toBeUndefined();
    await page.locator('video').evaluate((video) => new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('video metadata failed')), { once: true });
    }));
    await page.locator('video').evaluate((video) => video.play());

    await expect.poll(() => eventTypes(started.userId)).toContain('webinar_started');
    const reminders = (await store.listDeliveryOperations({ userId: started.userId }))
      .filter((operation) => operation.descriptor?.ruleName?.startsWith('webinar_reminder_'));
    expect(reminders.map((operation) => operation.status)).toEqual(['cancelled', 'cancelled']);

    await expect.poll(() => eventTypes(started.userId)).toContain('watched_25');
    const continueWatching = await operationByRule(started.userId, 'continue_watching_6h');
    expect(continueWatching.status).toBe('scheduled');
    const originalContinueTime = continueWatching.earliestExecutionAt;
    schedulerClock.value = new Date(originalContinueTime);
    expect((await flow.runWarmingScheduler()).deferred).toBe(1);
    expect(new Date((await store.getDeliveryOperation(continueWatching.id)).earliestExecutionAt).getTime())
      .toBeGreaterThan(new Date(originalContinueTime).getTime());

    await expect.poll(() => eventTypes(started.userId)).toContain('watched_50');
    expect((await store.getDeliveryOperation(continueWatching.id)).status).toBe('cancelled');
    await expect.poll(() => eventTypes(started.userId)).toContain('watched_75');
    const followUp = await operationByRule(started.userId, 'application_follow_up_2h');
    expect(followUp.status).toBe('scheduled');
    await expect.poll(() => eventTypes(started.userId)).toContain('webinar_completed');
    await page.screenshot({ path: '/tmp/men-funnel-webinar-e2e.png', fullPage: false });

    await page.reload();
    await expect(page.locator('video')).toBeVisible();
    const secondTab = await context.newPage();
    await secondTab.goto(webinarUrl);
    await expect(secondTab.locator('video')).toBeVisible();
    await Promise.all([
      page.locator('video').evaluate(async (video) => { video.currentTime = 0; await video.play(); await new Promise((resolve) => setTimeout(resolve, 1200)); video.pause(); }),
      secondTab.locator('video').evaluate(async (video) => { video.currentTime = 0; await video.play(); await new Promise((resolve) => setTimeout(resolve, 1200)); video.pause(); }),
    ]);
    await secondTab.close();
    const milestoneTypes = ['webinar_started', 'watched_25', 'watched_50', 'watched_75', 'watched_90', 'watched_100', 'webinar_completed'];
    const eventsAfterTabs = await eventTypes(started.userId);
    for (const type of milestoneTypes) expect(eventsAfterTabs.filter((item) => item === type)).toHaveLength(1);

    await page.route(/\/application\?t=/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><link rel="icon" href="data:,"><title>Application flow</title><h1>Application flow</h1>',
    }));
    await page.getByRole('button', { name: 'Перейти к заявке' }).click();
    await page.waitForURL(/\/application\?t=/);
    await expect(page.getByRole('heading', { name: 'Application flow' })).toBeVisible();
    const applicationToken = new URL(page.url()).searchParams.get('t');
    expect(verifyFunnelToken(applicationToken, { purpose: 'application', secret: signingSecret }).ok).toBe(true);
    const applicationStartedStatus = await page.evaluate(async ({ token, requestId }) => {
      const response = await fetch('/v1/applications/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, requestId }),
      });
      return response.status;
    }, { token: applicationToken, requestId: randomUUID() });
    expect(applicationStartedStatus).toBe(201);
    expect((await store.getDeliveryOperation(followUp.id)).status).toBe('cancelled');
    expect(await eventTypes(started.userId)).toContain('application_started');
    expect(externalRequests).toEqual([]);
    expect({ consoleErrors, failedLocalResponses }).toEqual({ consoleErrors: [], failedLocalResponses: [] });
  });

  test('browser and media access reject invalid purposes, expiry and resource binding', async ({ page }) => {
    const started = await startUser();
    const now = Date.now();
    const application = signFunnelToken({ purpose: 'application', userRef: started.userId, funnelId: started.funnelId, secret: signingSecret, now: () => now });
    const expiredWebinar = signFunnelToken({ purpose: 'webinar', userRef: started.userId, funnelId: started.funnelId, ttlSeconds: 60, secret: signingSecret, now: () => now - 120_000 });
    for (const token of [null, expiredWebinar, application]) {
      const suffix = token ? `?t=${encodeURIComponent(token)}` : '';
      const response = await page.goto(`${browserOrigin}/webinar/${fixtureVideoId}${suffix}`);
      expect(response.status()).toBe(401);
      await expect(page.getByRole('heading', { name: /Ссылка недействительна/ })).toBeVisible();
    }

    const mediaBase = `${browserOrigin}/v1/webinar/media/${fixtureVideoId}`;
    const otherVideo = signFunnelToken({ purpose: 'media', userRef: started.userId, funnelId: started.funnelId, videoId: 'other-video', secret: signingSecret, now: () => now });
    const otherFunnel = signFunnelToken({ purpose: 'media', userRef: started.userId, funnelId: 'other-funnel', videoId: fixtureVideoId, secret: signingSecret, now: () => now });
    const expiredMedia = signFunnelToken({ purpose: 'media', userRef: started.userId, funnelId: started.funnelId, videoId: fixtureVideoId, ttlSeconds: 60, secret: signingSecret, now: () => now - 120_000 });
    for (const token of [null, started.webinar.token, otherVideo, otherFunnel, expiredMedia]) {
      const suffix = token ? `?mt=${encodeURIComponent(token)}` : '';
      const status = await page.evaluate(async (url) => (await fetch(url)).status, `${mediaBase}${suffix}`);
      expect(status).toBe(401);
    }
  });

  test('browser seek to 75 percent does not forge watched 75', async ({ page }) => {
    const started = await startUser();
    const webinarUrl = `${browserOrigin}/webinar/${fixtureVideoId}?t=${encodeURIComponent(started.webinar.token)}`;
    await page.goto(webinarUrl);
    const video = page.locator('video');
    await video.evaluate((element) => new Promise((resolve) => {
      if (element.readyState >= 1) return resolve();
      element.addEventListener('loadedmetadata', resolve, { once: true });
    }));
    await video.evaluate(async (element) => {
      element.currentTime = element.duration * 0.75;
      await new Promise((resolve) => element.addEventListener('seeked', resolve, { once: true }));
      await element.play();
      await new Promise((resolve) => setTimeout(resolve, 2200));
      element.pause();
    });
    await expect.poll(() => eventTypes(started.userId)).toContain('webinar_started');
    await page.waitForTimeout(500);
    expect(await eventTypes(started.userId)).not.toContain('watched_75');
  });
});
