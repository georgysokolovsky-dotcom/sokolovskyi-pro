import { defineConfig } from '@playwright/test';

const resolverIp = process.env.FUNNEL_E2E_RESOLVE_IP;
const resolverHost = process.env.FUNNEL_E2E_ORIGIN ? new URL(process.env.FUNNEL_E2E_ORIGIN).hostname : null;
const launchArgs = ['--autoplay-policy=no-user-gesture-required'];
if (resolverIp && resolverHost) launchArgs.push(`--host-resolver-rules=MAP ${resolverHost} ${resolverIp}`);

export default defineConfig({
  testDir: './e2e',
  testMatch: 'mux-staging.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 120_000 },
  outputDir: '/tmp/men-funnel-mux-playwright',
  reporter: [['line']],
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: launchArgs },
  },
});
