import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenWebinarFlow } from '../src/flow/men-webinar.mjs';
import { createApp } from '../src/http/app.mjs';
import { createTelegramBotApiTransport } from '../src/telegram/bot-api-transport.mjs';

const botToken = 'fake-test-token';
const webhookSecret = 'fake-webhook-secret';
const signingSecret = 'fake-signing-secret';

async function startFakeTelegram(t, responses = []) {
  const requests = [];
  let messageId = 100;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    requests.push({ method: request.method, url: request.url, body: rawBody ? JSON.parse(rawBody) : null });
    const behavior = responses.shift() ?? { type: 'success' };
    if (behavior.type === 'delay') {
      await new Promise((resolve) => setTimeout(resolve, behavior.ms));
    }
    if (behavior.type === 'http') {
      response.writeHead(behavior.status, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ ok: false }));
    }
    if (behavior.type === 'malformed-json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end('{not-json');
    }
    if (behavior.type === 'body') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(behavior.body));
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ok: true, result: { message_id: messageId++ } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

function makeTransport(baseUrl, timeoutMs = 1000) {
  return createTelegramBotApiTransport({ fetchImpl: fetch, baseUrl, botToken, timeoutMs });
}

function sampleMessage() {
  return {
    role: 'bonus',
    text: 'Бонус',
    buttons: [{ type: 'url', label: 'Открыть', url: 'https://example.test/bonus' }],
  };
}

test('Bot API transport sends sendMessage payload and returns a normalized result', async (t) => {
  const fake = await startFakeTelegram(t);
  const result = await makeTransport(fake.baseUrl).sendMessage({ telegramChatId: 12345, message: sampleMessage() });

  assert.deepEqual(result, { ok: true, provider: 'telegram-bot-api', messageId: '100' });
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].method, 'POST');
  assert.equal(fake.requests[0].url, `/bot${botToken}/sendMessage`);
  assert.deepEqual(fake.requests[0].body, {
    chat_id: 12345,
    text: 'Бонус',
    reply_markup: { inline_keyboard: [[{ text: 'Открыть', url: 'https://example.test/bonus' }]] },
  });
});

for (const status of [400, 500]) {
  test(`Bot API transport normalizes HTTP ${status}`, async (t) => {
    const fake = await startFakeTelegram(t, [{ type: 'http', status }]);
    await assert.rejects(
      makeTransport(fake.baseUrl).sendMessage({ telegramChatId: 1, message: sampleMessage() }),
      (error) => error.code === 'telegram_http_error' && error.status === status && !String(error).includes(botToken),
    );
  });
}

test('Bot API transport aborts a timed out request', async (t) => {
  const fake = await startFakeTelegram(t, [{ type: 'delay', ms: 200 }]);
  await assert.rejects(
    makeTransport(fake.baseUrl, 20).sendMessage({ telegramChatId: 1, message: sampleMessage() }),
    (error) => error.code === 'telegram_timeout' && !String(error).includes(botToken),
  );
});

test('Bot API transport rejects malformed JSON and malformed success bodies', async (t) => {
  const fake = await startFakeTelegram(t, [
    { type: 'malformed-json' },
    { type: 'body', body: { ok: true, result: {} } },
  ]);
  for (let index = 0; index < 2; index += 1) {
    await assert.rejects(
      makeTransport(fake.baseUrl).sendMessage({ telegramChatId: 1, message: sampleMessage() }),
      (error) => error.code === 'telegram_malformed_response' && !String(error).includes(botToken),
    );
  }
});

test('Bot API transport rejects Telegram ok false without exposing its response', async (t) => {
  const fake = await startFakeTelegram(t, [{ type: 'body', body: { ok: false, error_code: 400, description: `secret ${botToken}` } }]);
  await assert.rejects(
    makeTransport(fake.baseUrl).sendMessage({ telegramChatId: 1, message: sampleMessage() }),
    (error) => error.code === 'telegram_api_error' && !String(error).includes(botToken) && !String(error).includes('description'),
  );
});

test('local webhook sends notice, bonus and signed webinar invite once per update id', async (t) => {
  const fake = await startFakeTelegram(t);
  const store = new MemoryStore();
  store.seed(localFixture);
  const flow = createMenWebinarFlow({
    store,
    signingSecret,
    botUsername: localFixture.telegramBotUsername,
    entryNotice: localFixture.entryNotice,
    webinarBaseUrl: 'http://127.0.0.1:9999/webinar',
    transport: makeTransport(fake.baseUrl),
  });
  const app = createApp({ flow, mode: 'local', webhookSecret, adminKey: 'fake-admin-key' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.address().port}/v1/webhooks/telegram`;
  const update = { update_id: 777, message: { from: { id: 98765, first_name: 'Тест' }, text: '/start article_wife_cheating' } };
  const sendUpdate = async (body = update) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookSecret },
      body: JSON.stringify(body),
    });
    return response.json();
  };

  const concurrent = await Promise.all([sendUpdate(), sendUpdate()]);
  assert.deepEqual(concurrent.map((body) => body.duplicate).sort(), [false, true]);
  const repeated = await sendUpdate();
  assert.equal(repeated.duplicate, true);
  const conflictingDuplicate = await sendUpdate({
    update_id: 777,
    message: { from: { id: 11111, first_name: 'Дубль' }, text: '/start instagram_men_webinar' },
  });
  assert.equal(conflictingDuplicate.duplicate, true);
  assert.equal(fake.requests.length, 3);
  assert.equal(store.users.size, 1);
  assert.deepEqual(fake.requests.map((item) => item.body.chat_id), ['98765', '98765', '98765']);
  assert.match(fake.requests[0].body.text, /\/stop/);
  assert.equal(fake.requests[0].body.reply_markup, undefined);
  assert.equal(fake.requests[1].body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/georgy_sokolovsky/44');
  assert.doesNotMatch(JSON.stringify(fake.requests), /georgy_sokolovsky\/16/);

  const webinarUrl = new URL(fake.requests[2].body.reply_markup.inline_keyboard[0][0].url);
  assert.equal(`${webinarUrl.origin}${webinarUrl.pathname}`, 'http://127.0.0.1:9999/webinar/lab-men-funnel-video-fixture');
  const token = webinarUrl.searchParams.get('t');
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(payload.purpose, 'webinar');
  assert.equal(payload.funnel_id, 'men_webinar_v1');

  const events = store.events.map((event) => event.eventType);
  assert.equal(events.filter((event) => event === 'telegram_start').length, 1);
  assert.equal(events.filter((event) => event === 'bonus_sent').length, 1);
  assert.equal(events.filter((event) => event === 'webinar_invite_sent').length, 1);
  assert.doesNotMatch(JSON.stringify(concurrent), /98765|userId|http:\/\/127\.0\.0\.1:9999|\.ey/);
});
