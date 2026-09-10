import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { FunnelError } from '../flow/men-webinar.mjs';
import { renderWebinarDeniedPage, renderWebinarPage } from '../webinar/page.mjs';

const maxBodyBytes = 64 * 1024;
const playerClient = readFileSync(new URL('../webinar/player-client.js', import.meta.url));
const stagingMedia = readFileSync(new URL('../../assets/staging-webinar-fixture.mp4', import.meta.url));

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new FunnelError('body_too_large', 'Request body is too large', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new FunnelError('invalid_json', 'Invalid JSON');
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function sendWebinarDocument(response, status, body) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  response.end(body);
}

function sendStagingMedia(request, response) {
  const media = stagingMedia;
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': media.length, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' });
    return response.end(media);
  }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= media.length) {
    response.writeHead(416, { 'content-range': `bytes */${media.length}` });
    return response.end();
  }
  response.writeHead(206, {
    'content-type': 'video/mp4', 'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${media.length}`, 'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
  });
  return response.end(media.subarray(start, end + 1));
}

function requireLocalAdmin(request, adminKey) {
  if (!adminKey || request.headers['x-admin-local-key'] !== adminKey) throw new FunnelError('unauthorized', 'Unauthorized', 401);
}

export function createApp({ flow, mode = 'local', webhookSecret = null, adminKey = null }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? 'GET';

      if (mode === 'local') {
        response.setHeader('access-control-allow-origin', '*');
        response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        response.setHeader('access-control-allow-headers', 'content-type, x-telegram-bot-api-secret-token, x-admin-local-key');
        if (method === 'OPTIONS') return sendJson(response, 204, {});
      }

      if (method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { ok: true, mode });
      }

      if (method === 'GET' && url.pathname === '/v1/webinar/player.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return response.end(playerClient);
      }

      if (method === 'GET' && url.pathname === '/v1/webinar/media/lab-men-funnel-video-fixture') {
        return sendStagingMedia(request, response);
      }

      const webinarPageMatch = url.pathname.match(/^\/webinar\/([a-z0-9_-]{1,120})$/i);
      if (method === 'GET' && webinarPageMatch) {
        try {
          const session = await flow.openWebinarPage({ token: url.searchParams.get('t'), videoId: webinarPageMatch[1] });
          return sendWebinarDocument(response, 200, renderWebinarPage(session));
        } catch (error) {
          const status = error instanceof FunnelError ? error.status : 500;
          return sendWebinarDocument(response, status, renderWebinarDeniedPage());
        }
      }

      if (method === 'POST' && url.pathname === '/v1/test/telegram/start') {
        if (mode !== 'local') throw new FunnelError('not_found', 'Not found', 404);
        const body = await readJson(request);
        const result = await flow.handleTelegramStart(body);
        return sendJson(response, 200, { ok: true, ...result });
      }

      if (method === 'POST' && url.pathname === '/v1/webhooks/telegram') {
        if (!webhookSecret || request.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) throw new FunnelError('unauthorized', 'Unauthorized', 401);
        const body = await readJson(request);
        const message = body.message;
        const text = typeof message?.text === 'string' ? message.text : '';
        const match = text.match(/^\/start(?:\s+([a-z0-9_-]{1,64}))?$/i);
        if (!match || !message?.from?.id) return sendJson(response, 200, { ok: true, ignored: true });
        const result = await flow.handleTelegramStart({
          telegramUserId: message.from.id,
          firstName: message.from.first_name ?? null,
          username: message.from.username ?? null,
          languageCode: message.from.language_code ?? null,
          startParameter: match[1] ?? '',
          updateId: body.update_id ?? null,
        });
        return sendJson(response, 200, {
          ok: true,
          duplicate: result.duplicate,
          bonusId: result.bonus?.id ?? null,
          noticeStatus: result.notice.status,
          bonusStatus: result.bonusDelivery.status,
          webinarInviteStatus: result.webinarInviteDelivery.status,
        });
      }

      if (method === 'POST' && ['/v1/webinar/session', '/v1/video/session'].includes(url.pathname)) {
        const body = await readJson(request);
        const session = await flow.createWebinarSession(body.token);
        return sendJson(response, 200, { ok: true, funnelId: session.funnelId, purpose: session.purpose, webinar: session.webinar });
      }

      if (method === 'POST' && url.pathname === '/v1/webinar/telemetry') {
        const body = await readJson(request);
        const result = await flow.ingestWebinarTelemetry(body);
        return sendJson(response, result.duplicate ? 200 : 201, { ok: true, ...result });
      }

      if (method === 'POST' && url.pathname === '/v1/webinar/cta') {
        const body = await readJson(request);
        const result = await flow.recordWebinarCta(body);
        return sendJson(response, result.duplicate ? 200 : 201, { ok: true, eventType: result.event.eventType, duplicate: result.duplicate, leadStatus: result.status });
      }

      if (method === 'POST' && url.pathname === '/v1/applications/events') {
        const body = await readJson(request);
        const result = await flow.recordApplicationStarted(body);
        return sendJson(response, result.duplicate ? 200 : 201, { ok: true, eventType: result.event.eventType, duplicate: result.duplicate, leadStatus: result.status });
      }

      if (method === 'POST' && url.pathname === '/v1/applications/token') {
        const body = await readJson(request);
        const result = await flow.createApplicationToken({ token: body.token });
        return sendJson(response, 201, { ok: true, ...result });
      }

      if (method === 'POST' && url.pathname === '/v1/applications') {
        const body = await readJson(request);
        const result = await flow.submitApplication(body);
        return sendJson(response, result.duplicate ? 200 : 201, { ok: true, applicationId: result.application.id, status: result.application.status, duplicate: result.duplicate });
      }

      if (method === 'GET' && url.pathname === '/v1/admin/dashboard') {
        requireLocalAdmin(request, adminKey);
        return sendJson(response, 200, { ok: true, dashboard: await flow.dashboard(url.searchParams.get('funnel_id') ?? undefined) });
      }

      const leadMatch = url.pathname.match(/^\/v1\/admin\/leads\/([^/]+)$/);
      if (method === 'GET' && leadMatch) {
        requireLocalAdmin(request, adminKey);
        return sendJson(response, 200, { ok: true, lead: await flow.leadDetails(leadMatch[1]) });
      }

      throw new FunnelError('not_found', 'Not found', 404);
    } catch (error) {
      const status = error instanceof FunnelError ? error.status : 500;
      const code = error instanceof FunnelError ? error.code : 'internal_error';
      if (status >= 500) console.error(JSON.stringify({ code }));
      return sendJson(response, status, { ok: false, error: code });
    }
  });
}
