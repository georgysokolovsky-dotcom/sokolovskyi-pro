import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { databasePoolOptions } from '../src/store/pool-options.mjs';

const certificate = rootCertificates[0];
const certificateBase64 = Buffer.from(certificate).toString('base64');
const production = {
  FUNNEL_MODE: 'production',
  DATABASE_URL: 'postgresql://db.example.invalid/men_funnel_production',
  DATABASE_SSL_MODE: 'verify-full',
};

test('production verify-full passes the decoded CA to pg without weakening verification', () => {
  const options = databasePoolOptions({ ...production, DATABASE_SSL_CA_BASE64: certificateBase64 });
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, ca: `${certificate.trim()}\n` });
});

test('production verify-full rejects a missing CA', () => {
  assert.throws(() => databasePoolOptions(production), /DATABASE_SSL_CA_BASE64 is required/);
});

test('invalid base64 is rejected without echoing its value', () => {
  const secret = 'not-base64-$-sensitive-marker';
  assert.throws(() => databasePoolOptions({ ...production, DATABASE_SSL_CA_BASE64: secret }), (error) => {
    assert.match(error.message, /valid base64/);
    assert.doesNotMatch(error.message, new RegExp(secret.replaceAll('$', '\\$')));
    return true;
  });
});

test('decoded non-certificate content is rejected without echoing it', () => {
  const secret = 'sensitive decoded marker';
  const encoded = Buffer.from(secret).toString('base64');
  assert.throws(() => databasePoolOptions({ ...production, DATABASE_SSL_CA_BASE64: encoded }), (error) => {
    assert.match(error.message, /one PEM certificate/);
    assert.doesNotMatch(error.message, /sensitive decoded marker/);
    assert.doesNotMatch(error.message, new RegExp(encoded));
    return true;
  });
});

test('PEM-shaped but invalid certificate is rejected', () => {
  const encoded = Buffer.from('-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----').toString('base64');
  assert.throws(() => databasePoolOptions({ ...production, DATABASE_SSL_CA_BASE64: encoded }), /valid PEM CA certificate/);
});

test('production rejects SSL query parameters that could override the trusted CA', () => {
  const databaseUrl = `${production.DATABASE_URL}?sslrootcert=unexpected.pem`;
  assert.throws(() => databasePoolOptions({ ...production, DATABASE_URL: databaseUrl,
    DATABASE_SSL_CA_BASE64: certificateBase64 }), /SSL options must be configured separately/);
});

test('staging and test defaults continue without a required custom CA', () => {
  const staging = databasePoolOptions({ DATABASE_URL: 'postgresql://db.example.invalid/men_funnel_staging', FUNNEL_MODE: 'staging' });
  assert.equal(staging.ssl, false);
  const stagingVerified = databasePoolOptions({ DATABASE_URL: 'postgresql://db.example.invalid/men_funnel_staging',
    FUNNEL_MODE: 'staging', DATABASE_SSL_MODE: 'verify-full' });
  assert.deepEqual(stagingVerified.ssl, { rejectUnauthorized: true });
});
