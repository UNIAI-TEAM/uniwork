import { chromium } from "@playwright/test";

/**
 * The API the specs seed and poll. It must be the API the web build was
 * pointed at (NEXT_PUBLIC_API_URL is inlined at `next build`); a run that
 * builds the web against another port while this falls back to :8080 talks to
 * whatever else is listening there — on a warm runner, a stale server from an
 * earlier round — and fails far from the cause, or passes against old code.
 */
export const e2eApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
export const e2eBaseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Opens the web app once and fails the run unless its first API request goes
 * to the same origin as {@link e2eApiUrl}. Every page asks GET /api/v1/config
 * at boot (WebFeatureFlagsProvider), so the request is always there.
 */
export async function assertWebUsesE2eApi(): Promise<void> {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await browser.newPage();
    const request = page.waitForRequest((r) => new URL(r.url()).pathname.startsWith("/api/v1/"), { timeout: 30_000 });
    await page.goto(new URL("/login", e2eBaseUrl).toString());
    const seen = await request.catch(() => null);
    if (!seen) {
      throw new Error(`the web app at ${e2eBaseUrl} made no /api/v1/ request within 30 s; is it up?`);
    }
    const appApi = new URL(seen.url()).origin;
    const specApi = new URL(e2eApiUrl).origin;
    if (appApi !== specApi) {
      throw new Error(
        `the web app at ${e2eBaseUrl} calls the API at ${appApi}, but the specs would seed ${specApi}. ` +
          "Run Playwright with NEXT_PUBLIC_API_URL set to the API the web build was given.",
      );
    }
  } finally {
    await browser.close();
  }
}
