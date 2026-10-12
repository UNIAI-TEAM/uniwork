import { expect, test } from "@playwright/test";

test("UNI follows a spatial route through run, jump and land, and reverses to the same frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const world = page.locator(".studio-world");
  await expect(world).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  const sample = async (progress: number) => {
    await page.evaluate(p => window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * p, behavior: "instant" }), progress);

    await expect.poll(async () => Math.abs(Number(await world.getAttribute("data-pose")) - progress)).toBeLessThan(.001);
    await expect(world).toHaveAttribute("data-running", "false");
  };
  await sample(.20); await expect(world).toHaveAttribute("data-action", "run");
  const run = await world.locator("canvas").screenshot({ style: ".landing-site > :not(.studio-world), nextjs-portal { visibility: hidden !important; }" });
  await sample(.30); await expect(world).toHaveAttribute("data-action", "jump");
  expect((await world.locator("canvas").screenshot({ style: ".landing-site > :not(.studio-world), nextjs-portal { visibility: hidden !important; }" })).equals(run)).toBe(false);
  await sample(.36); await expect(world).toHaveAttribute("data-action", "land");
  await sample(.20);
  expect((await world.locator("canvas").screenshot({ style: ".landing-site > :not(.studio-world), nextjs-portal { visibility: hidden !important; }" })).equals(run)).toBe(true);
});

test("the official shared mark supplies the 3D vest and the world resizes with the viewport", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/");
  const world = page.locator(".studio-world");
  await expect(world).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  await expect(world.locator(".studio-world-mark svg")).toHaveAttribute("viewBox", "0 0 128 92");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => world.locator("canvas").evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return Math.abs(bounds.width - document.documentElement.clientWidth) < 1 && Math.abs(bounds.height - innerHeight) < 1;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("losing the WebGL context exposes the architectural still and keeps navigation available", async ({ page }) => {
  await page.goto("/");
  const world = page.locator(".studio-world");
  await expect(world).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  await world.locator("canvas").evaluate((el: HTMLCanvasElement) => {
    el.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(world).toHaveAttribute("data-rendered", "false");
  await expect(world.locator("img")).toBeVisible();
  await expect(page.locator(".landing-hero-actions a")).toBeInViewport();
});