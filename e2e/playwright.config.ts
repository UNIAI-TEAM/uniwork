import { defineConfig } from "@playwright/test";
import { VI_LOCALE_STATE } from "./locale-state";

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
    channel: process.env.PLAYWRIGHT_CHANNEL,
    // The specs are written against the Vietnamese product. The app shows
    // English until the locale cookie says otherwise (see locale-state.ts);
    // `locale` keeps dates and number formats Vietnamese too.
    locale: "vi-VN",
    storageState: VI_LOCALE_STATE,
    trace: "retain-on-failure",
  },
});
