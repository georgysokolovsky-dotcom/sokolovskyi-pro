import { createPrivateKey, sign } from 'node:crypto';

const muxPlaybackIdPattern = /^[a-zA-Z0-9]{1,200}$/;

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function normalizeMuxPrivateKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Mux signing private key is required');
  const candidate = value.trim().replaceAll('\\n', '\n').trim();
  const pem = candidate.includes('-----BEGIN ') ? candidate : Buffer.from(candidate, 'base64').toString('utf8').replaceAll('\\n', '\n').trim();
  if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----$/.test(pem)) throw new Error('Mux signing private key is invalid');
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('invalid_key_type');
    return key;
  } catch {
    throw new Error('Mux signing private key is invalid');
  }
}

export function signMuxPlaybackJwt({ keyId, privateKey, playbackId, expiresAt, audience = 'v' }) {
  if (typeof keyId !== 'string' || !keyId.trim() || keyId.length > 200) throw new Error('Mux signing key ID is invalid');
  if (!muxPlaybackIdPattern.test(playbackId ?? '')) throw new Error('Mux playback ID is invalid');
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) throw new Error('Mux playback expiration is invalid');
  const encodedHeader = encodeJson({ alg: 'RS256', typ: 'JWT', kid: keyId.trim() });
  const encodedPayload = encodeJson({ sub: playbackId, aud: audience, exp: expiresAt });
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export function createMuxMediaSource({
  keyId,
  privateKey,
  playbackId,
  tokenTtlSeconds = 60 * 60,
  playbackBufferSeconds = 10 * 60,
  now = Date.now,
}) {
  const signingKey = normalizeMuxPrivateKey(privateKey);
  if (typeof keyId !== 'string' || !keyId.trim() || keyId.length > 200) throw new Error('Mux signing key ID is invalid');
  if (!muxPlaybackIdPattern.test(playbackId ?? '')) throw new Error('Mux playback ID is invalid');
  if (!Number.isInteger(tokenTtlSeconds) || tokenTtlSeconds <= 0) throw new Error('Mux playback token TTL is invalid');
  if (!Number.isInteger(playbackBufferSeconds) || playbackBufferSeconds < 0) throw new Error('Mux playback buffer is invalid');

  return Object.freeze({
    name: 'mux',
    createPlaybackSource({ webinar }) {
      const durationSeconds = Math.ceil(Number(webinar.durationSeconds));
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Webinar duration is invalid');
      const effectiveTtlSeconds = Math.max(tokenTtlSeconds, durationSeconds + playbackBufferSeconds);
      const expiresAt = Math.floor(now() / 1000) + effectiveTtlSeconds;
      const token = signMuxPlaybackJwt({ keyId, privateKey: signingKey, playbackId, expiresAt });
      return {
        videoProvider: 'mux-hls',
        videoUrl: `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8?token=${encodeURIComponent(token)}`,
        playbackExpiresAt: new Date(expiresAt * 1000).toISOString(),
      };
    },
  });
}
