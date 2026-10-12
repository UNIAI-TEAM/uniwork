import { expect, test } from "@playwright/test";

test("studio world renders a dimensional character and scrubs its action with scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const world = page.locator(".studio-world");
  await expect(world).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  await expect(world.locator("canvas")).toBeVisible();
  await expect(page.locator(".landing-scroll-mascot")).toHaveCount(0);
  const opening = await world.getAttribute("data-pose");
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight * .2, behavior: "instant" }));
  await expect.poll(() => world.getAttribute("data-pose")).not.toBe(opening);
  await expect(world).toHaveAttribute("data-running", "false");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => world.getAttribute("data-pose")).toBe(opening);
});

test("pausing and reduced motion freeze the actual studio rendering", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const world = page.locator(".studio-world");
  await expect(world).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  const still = await world.getAttribute("data-pose");
  await page.evaluate(() => window.scrollTo({ top: 1400, behavior: "instant" }));
  await expect(world).toHaveAttribute("data-motion", "paused");
  await expect(world).toHaveAttribute("data-pose", still);
  await page.locator(".studio-world-toggle").click();
  await expect(world).toHaveAttribute("data-motion", "scroll");
  await page.locator(".studio-world-toggle").click();
  await expect(world).toHaveAttribute("data-motion", "paused");
  await expect(world).toHaveAttribute("data-running", "false");
  const paused = await world.locator("canvas").screenshot({ style: ".landing-site > :not(.studio-world), nextjs-portal { visibility: hidden !important; }" });
  await page.evaluate(() => window.scrollTo({ top: 2400, behavior: "instant" }));
  expect((await world.locator("canvas").screenshot({ style: ".landing-site > :not(.studio-world), nextjs-portal { visibility: hidden !important; }" })).equals(paused)).toBe(true);
});

test("the studio and foreground conversion action fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".studio-world")).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  await expect(page.locator(".landing-hero-actions a")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
