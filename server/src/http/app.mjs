import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { FunnelError } from '../flow/men-webinar.mjs';
import { renderWebinarDeniedPage, renderWebinarPage } from '../webinar/page.mjs';
import { createLocalFixtureMediaSource } from '../webinar/local-media-source.mjs';
import { renderApplicationPage, renderApplicationDeniedPage } from '../application/page.mjs';

const maxBodyBytes = 64 * 1024;
const playerClient = readFileSync(new URL('../webinar/player-client.js', import.meta.url));
const hlsClient = readFileSync(new URL(import.meta.resolve('hls.js/dist/hls.min.js')));
const applicationClient = readFileSync(new URL('../application/form-client.js', import.meta.url));

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
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function sendWebinarDocument(response, status, body, { allowMux = false } = {}) {
  const muxConnect = allowMux ? ' https://stream.mux.com https://*.mux.com' : '';
  const muxMedia = allowMux ? ' blob: https://stream.mux.com https://*.mux.com' : '';
  const workerSource = allowMux ? "worker-src 'self' blob:; " : '';
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; media-src 'self'${muxMedia}; connect-src 'self'${muxConnect}; ${workerSource}img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  });
  response.end(body);
}

function requireLocalAdmin(request, adminKey) {
  if (!adminKey || request.headers['x-admin-local-key'] !== adminKey) throw new FunnelError('unauthorized', 'Unauthorized', 401);
}

export function createApp({ flow, mode = 'local', webhookSecret = null, adminKey = null, allowedTelegramUserId = null,
  telegramOutboundEnabled = true, adminApiEnabled = mode !== 'production', privacyPolicyUrl = null,
  applicationConsentVersion = null, applicationConsentText = null, logger = null, mediaSource = createLocalFixtureMediaSource() }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? 'GET';
      const sameOriginWebinarSurface = url.pathname.startsWith('/webinar/') || url.pathname.startsWith('/v1/webinar/');

      if (mode === 'local' && !sameOriginWebinarSurface) {
        response.setHeader('access-control-allow-origin', '*');
        response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        response.setHeader('access-control-allow-headers', 'content-type, x-telegram-bot-api-secret-token, x-admin-local-key');
        if (method === 'OPTIONS') return sendJson(response, 204, {});
      }

      if (method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { ok: true, mode });
      }

      if (method === 'GET' && url.pathname === '/application') {
        try {
          if (mode === 'production' && (!privacyPolicyUrl || !applicationConsentVersion || !applicationConsentText)) throw new FunnelError('legal_config_missing', 'Legal configuration is required', 503);
          const access = await flow.validateApplicationAccess({ token: url.searchParams.get('t') });
          return sendWebinarDocument(response, 200, renderApplicationPage(access, { privacyPolicyUrl, consentVersion: applicationConsentVersion, consentText: applicationConsentText }));
        } catch (error) {
          return sendWebinarDocument(response, error instanceof FunnelError ? error.status : 500, renderApplicationDeniedPage());
        }
      }

      if (method === 'GET' && url.pathname === '/v1/applications/form.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return response.end(applicationClient);
      }

      if (method === 'GET' && url.pathname === '/v1/webinar/player.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return response.end(playerClient);
      }

      if (method === 'GET' && url.pathname === '/v1/webinar/hls.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
        return response.end(hlsClient);
      }

      const mediaMatch = url.pathname.match(/^\/v1\/webinar\/media\/([a-z0-9_-]{1,120})$/i);
      if (['GET', 'HEAD'].includes(method) && mediaMatch) {
        const authorization = await flow.authorizeWebinarMedia({ token: url.searchParams.get('mt'), videoId: mediaMatch[1] });
        if (!mediaSource.canServe(authorization.webinar)) throw new FunnelError('media_unavailable', 'Media is unavailable', 404);
        return mediaSource.send(request, response, authorization);
      }

      const webinarPageMatch = url.pathname.match(/^\/webinar\/([a-z0-9_-]{1,120})$/i);
      if (method === 'GET' && webinarPageMatch) {
        try {
          const session = await flow.openWebinarPage({ token: url.searchParams.get('t'), videoId: webinarPageMatch[1] });
          return sendWebinarDocument(response, 200, renderWebinarPage(session), { allowMux: session.webinar.videoProvider === 'mux-hls' });
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
        if (!webhookSecret || request.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) {
          logger?.info?.({ event: 'telegram_webhook_rejected', reason: 'unauthorized' });
          throw new FunnelError('unauthorized', 'Unauthorized', 401);
        }
        const body = await readJson(request);
        const message = body.message;
        if (allowedTelegramUserId != null && String(message?.from?.id) !== String(allowedTelegramUserId)) {
          logger?.info?.({ event: 'telegram_webhook_rejected', reason: 'allowlist' });
          return sendJson(response, 200, { ok: true, ignored: true });
        }
        if (mode === 'production' && !telegramOutboundEnabled) {
          logger?.info?.({ event: 'telegram_webhook_rejected', reason: 'outbound_disabled' });
          throw new FunnelError('outbound_disabled', 'Outbound disabled', 503);
        }
        const text = typeof message?.text === 'string' ? message.text : '';
        const match = text.match(/^\/start(?:\s+([a-z0-9_-]{1,64}))?$/i);
        if (!match || !message?.from?.id) { logger?.info?.({ event: 'telegram_webhook_rejected', reason: 'unsupported' }); return sendJson(response, 200, { ok: true, ignored: true }); }
        const result = await flow.handleTelegramStart({
          telegramUserId: message.from.id,
          firstName: message.from.first_name ?? null,
          username: message.from.username ?? null,
          languageCode: message.from.language_code ?? null,
          startParameter: match[1] ?? '',
          updateId: body.update_id ?? null,
        });
        logger?.info?.({ event: 'telegram_webhook_accepted', duplicate: result.duplicate,
          notice: result.notice.status, bonus: result.bonusDelivery.status, invite: result.webinarInviteDelivery.status });
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
        logger?.info?.({ event: 'application_submitted', duplicate: result.duplicate });
        return sendJson(response, result.duplicate ? 200 : 201, { ok: true, applicationId: result.application.id, status: result.application.status, duplicate: result.duplicate });
      }

      if (method === 'GET' && url.pathname === '/v1/admin/dashboard') {
        if (mode === 'production' && !adminApiEnabled) throw new FunnelError('not_found', 'Not found', 404);
        requireLocalAdmin(request, adminKey);
        return sendJson(response, 200, { ok: true, dashboard: await flow.dashboard(url.searchParams.get('funnel_id') ?? undefined) });
      }

      const leadMatch = url.pathname.match(/^\/v1\/admin\/leads\/([^/]+)$/);
      if (method === 'GET' && leadMatch) {
        if (mode === 'production' && !adminApiEnabled) throw new FunnelError('not_found', 'Not found', 404);
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
