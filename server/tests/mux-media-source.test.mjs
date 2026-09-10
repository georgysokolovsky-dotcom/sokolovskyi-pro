import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createMuxMediaSource, normalizeMuxPrivateKey } from '../src/webinar/providers/mux-media-source.mjs';
import { summarizeWebinarProgress } from '../src/webinar/progress.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function decodeJwt(token) {
  const [header, payload, signature] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url')),
    payload: JSON.parse(Buffer.from(payload, 'base64url')),
    signingInput: `${header}.${payload}`,
    signature: Buffer.from(signature, 'base64url'),
  };
}

test('Mux source signs an exact RS256 video JWT and enforces duration plus buffer TTL', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z');
  const source = createMuxMediaSource({
    keyId: 'test-key-id', privateKey: pem, playbackId: 'TestPlayback123',
    tokenTtlSeconds: 60, playbackBufferSeconds: 600, now: () => now,
  });
  const playback = source.createPlaybackSource({ webinar: { durationSeconds: 1800 } });
  const url = new URL(playback.videoUrl);
  const decoded = decodeJwt(url.searchParams.get('token'));
  assert.equal(playback.videoProvider, 'mux-hls');
  assert.equal(`${url.origin}${url.pathname}`, 'https://stream.mux.com/TestPlayback123.m3u8');
  assert.deepEqual(decoded.header, { alg: 'RS256', typ: 'JWT', kid: 'test-key-id' });
  assert.deepEqual(decoded.payload, { sub: 'TestPlayback123', aud: 'v', exp: Math.floor(now / 1000) + 2400 });
  assert.equal(verify('RSA-SHA256', Buffer.from(decoded.signingInput), publicKey, decoded.signature), true);
  assert.equal(playback.playbackExpiresAt, '2026-09-10T12:40:00.000Z');
});

test('Mux private key accepts raw, escaped-newline and base64 PEM without exposing it in errors', () => {
  for (const value of [pem, pem.replaceAll('\n', '\\n'), Buffer.from(pem).toString('base64')]) {
    assert.equal(normalizeMuxPrivateKey(value).asymmetricKeyType, 'rsa');
  }
  const disclosed = 'not-a-private-key-value';
  assert.throws(() => normalizeMuxPrivateKey(disclosed), (error) => {
    assert.equal(error.message.includes(disclosed), false);
    return /invalid/.test(error.message);
  });
});

test('Mux source fails closed on incomplete or invalid configuration', () => {
  assert.throws(() => createMuxMediaSource({ keyId: '', privateKey: pem, playbackId: 'TestPlayback123' }), /key ID/);
  assert.throws(() => createMuxMediaSource({ keyId: 'key', privateKey: '', playbackId: 'TestPlayback123' }), /required/);
  assert.throws(() => createMuxMediaSource({ keyId: 'key', privateKey: pem, playbackId: '../bad' }), /playback ID/);
  assert.throws(() => createMuxMediaSource({ keyId: 'key', privateKey: pem, playbackId: 'TestPlayback123', tokenTtlSeconds: 0 }), /TTL/);
});

test('an accepted ended event closes only a nearly complete watched range', () => {
  const completed = summarizeWebinarProgress({ segments: [{ start: 0.2, end: 20 }], durationSeconds: 20, started: true, endedNearFinish: true });
  assert.equal(completed.progressPercent, 100);
  assert.ok(completed.milestones.includes(100));
  const seekedToEnd = summarizeWebinarProgress({ segments: [{ start: 18, end: 20 }], durationSeconds: 20, started: true, endedNearFinish: true });
  assert.equal(seekedToEnd.progressPercent, 10);
  assert.equal(seekedToEnd.milestones.includes(100), false);
});
