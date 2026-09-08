import { createHmac, timingSafeEqual } from 'node:crypto';

const encode = (value) => Buffer.from(value, 'utf8').toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');

function signatureFor(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function signFunnelToken({ purpose, userRef, funnelId, ttlSeconds = 60 * 60, secret, now = Date.now }) {
  if (!secret) throw new Error('TOKEN_SIGNING_SECRET is required');
  if (!purpose || !userRef || !funnelId) throw new Error('Token purpose, user reference and funnel ID are required');
  const issuedAt = Math.floor(now() / 1000);
  const payload = {
    purpose,
    funnel_id: funnelId,
    user_ref: userRef,
    issued_at: issuedAt,
    expires_at: issuedAt + ttlSeconds,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signatureFor(encodedPayload, secret)}`;
}

export function verifyFunnelToken(token, { purpose, secret, now = Date.now } = {}) {
  if (!secret || typeof token !== 'string') return { ok: false, code: 'invalid_token' };
  const [encodedPayload, encodedSignature, ...extra] = token.split('.');
  if (!encodedPayload || !encodedSignature || extra.length > 0) return { ok: false, code: 'invalid_token' };

  const expected = signatureFor(encodedPayload, secret);
  const receivedBuffer = Buffer.from(encodedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return { ok: false, code: 'invalid_token' };
  }

  try {
    const payload = JSON.parse(decode(encodedPayload));
    const current = Math.floor(now() / 1000);
    if (!payload.purpose || !payload.user_ref || !payload.funnel_id || !Number.isInteger(payload.issued_at) || !Number.isInteger(payload.expires_at)) {
      return { ok: false, code: 'invalid_token' };
    }
    if (purpose && payload.purpose !== purpose) {
      return { ok: false, code: 'wrong_token_purpose' };
    }
    if (payload.expires_at <= current) {
      return { ok: false, code: 'expired_token' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, code: 'invalid_token' };
  }
}
