import { defineConfig } from "@playwright/test";

const outputDir =
  process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  outputDir,
  // Local `make check` hits the same IP rate limits as CI; serial workers
  // avoid 429s on /auth/register and /me/email/verify during parallel signup.
  workers: process.env.CI ? undefined : 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // The specs are written against the Vietnamese product; the app now
    // follows the browser's language, and Chromium's default is en-US.
    locale: "vi-VN",
    trace: "retain-on-failure",
  },
});
