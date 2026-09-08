import { createServer } from 'node:http';
import { FunnelError } from '../flow/men-webinar.mjs';

const maxBodyBytes = 64 * 1024;

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
          userId: result.userId,
          duplicate: result.duplicate,
          bonusId: result.bonus?.id ?? null,
          bonusStatus: result.bonusDelivery.status,
        });
      }

      if (method === 'POST' && ['/v1/webinar/session', '/v1/video/session'].includes(url.pathname)) {
        const body = await readJson(request);
        const session = flow.createWebinarSession(body.token);
        return sendJson(response, 200, { ok: true, funnelId: session.funnelId, purpose: session.purpose, webinar: session.webinar });
      }

      if (method === 'POST' && url.pathname === '/v1/events') {
        const body = await readJson(request);
        const result = flow.recordTokenEvent(body);
        return sendJson(response, result.duplicate ? 200 : 201, { ok: true, eventType: result.event.eventType, duplicate: result.duplicate, leadStatus: result.status });
      }

      if (method === 'POST' && url.pathname === '/v1/applications/token') {
        const body = await readJson(request);
        const result = flow.createApplicationToken({ token: body.token });
        return sendJson(response, 201, { ok: true, ...result });
      }

      if (method === 'POST' && url.pathname === '/v1/applications') {
        const body = await readJson(request);
        const result = flow.submitApplication(body);
        return sendJson(response, result.duplicate ? 200 : 201, { ok: true, applicationId: result.application.id, status: result.application.status, duplicate: result.duplicate });
      }

      if (method === 'GET' && url.pathname === '/v1/admin/dashboard') {
        requireLocalAdmin(request, adminKey);
        return sendJson(response, 200, { ok: true, dashboard: flow.dashboard(url.searchParams.get('funnel_id') ?? undefined) });
      }

      const leadMatch = url.pathname.match(/^\/v1\/admin\/leads\/([^/]+)$/);
      if (method === 'GET' && leadMatch) {
        requireLocalAdmin(request, adminKey);
        return sendJson(response, 200, { ok: true, lead: flow.leadDetails(leadMatch[1]) });
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
