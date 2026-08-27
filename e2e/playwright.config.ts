import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // The specs are written against the Vietnamese product; the app now
    // follows the browser's language, and Chromium's default is en-US.
    locale: "vi-VN",
    trace: "retain-on-failure",
  },
});
