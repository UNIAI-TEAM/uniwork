import type { Page } from "@playwright/test";

/**
 * React streams the page body into a hidden `<div id="S:n">` and moves it into
 * place when the boundary reveals, which React throttles and which waits for the
 * boundary's stylesheets. `goto` resolves on `load`, which can land before that
 * swap, so for a moment every id and class on the page exists twice (the hidden
 * staging copy and the live one) and a strict locator fails. Wait for the staging
 * copies to go. The poll runs here, not in the page, so a paused page clock
 * cannot stall it; if the boundary never reveals the caller proceeds and its own
 * assertion reports what is wrong.
 */
export async function landingReady(page: Page, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // A page that navigates again right away destroys the context mid-call.
    const settled = await page.evaluate(() => document.querySelector('[id^="S:"]') === null).catch(() => false);
    if (settled) return;
    await page.waitForTimeout(50);
  }
}
