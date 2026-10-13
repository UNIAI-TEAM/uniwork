import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { selectWorkspaceFeature, workspaceGroups } from "./landing-catalog-helpers";
import { auditText } from "./contrast";

test("preview plays a real sequence, pauses and stops outside the viewport", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#du-an");
  const player = page.locator(".product-playback");
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-running", "true");
  // Real time, not a faked clock: under load the film may already be past beat 1.
  await expect.poll(async () => Number(await player.getAttribute("data-step")), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  await expect(player.locator('[data-demo-detail="task"]')).toBeVisible();
  await player.getByRole("button", { name: "Dừng demo", exact: true }).click();
  // Short entrances must settle; pausing a caption halfway leaves clipped text.
  await expect.poll(() => player.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "paused").length)).toBe(0);
  const frozen = await player.getAttribute("data-step");
  await page.waitForTimeout(2800);
  await expect(player).toHaveAttribute("data-step", frozen!);
  await player.getByRole("button", { name: "Phát demo", exact: true }).click();
  await page.locator(".landing-site > footer").scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-running", "false");
});

test("reduced motion is still by default and manual exploration retains local actions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#du-an");
  const player = page.locator(".product-playback");
  await expect(player).toHaveAttribute("data-running", "false");
  await expect(player.locator(".demo-unassigned")).toBeVisible();
  await page.getByRole("button", { name: "Tự khám phá", exact: true }).click();
  const stage = page.locator("#product-preview");
  await stage.getByRole("searchbox").fill("phạm vi");
  await expect(stage.locator(".preview-task")).toHaveCount(1);
  await page.getByRole("button", { name: "Xem demo", exact: true }).click();
  await expect(player).toBeVisible();
  await page.getByRole("button", { name: "Tự khám phá", exact: true }).click();
  await expect(stage.getByRole("searchbox")).toHaveValue("phạm vi");
});

// Below 768px the stage shows a readable three-step story instead of the film
// (DESIGN.md, "readable three-step summary below 768px"); see the test after this loop.
for (const width of [1440]) {
  test(`every storyboard reaches its last beat without clipping at ${width}px`, async ({ page }) => {
    // Every clock tick also drives the 3D core and scroll ticker, so a full run of
    // five films takes minutes of wall time, not the default minute.
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#du-an");
    await page.clock.install();
    for (const key of ["tasks", "meetings", "chat", "ask", "email"]) {
      await selectWorkspaceFeature(page, key, false);
      const player = page.locator(".product-playback");
      await page.bringToFront();
      await player.scrollIntoViewIfNeeded();
      await expect(player).toBeInViewport({ ratio: .5 });
      await player.getByRole("button", { name: "Phát demo", exact: true }).click();
      await expect(player).toHaveAttribute("data-running", "true");
      const beatCount = Number(await player.getAttribute("data-beat-count"));
      for (let beat = 1; beat < beatCount; beat++) {
        await page.clock.runFor(2700);
        await expect(player).toHaveAttribute("data-step", String(beat));
        const clipped = await player.locator(".action-stage").evaluate(stage => {
          const bounds = stage.getBoundingClientRect();
          return [...stage.querySelectorAll(".action-source-picker, .action-create-dialog, .action-drawer, .action-member-picker, .action-source-detail")].filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.left < bounds.left || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1;
          }).map(element => element.className);
        });
        expect(clipped, `${key} beat ${beat} fits its own stage`).toEqual([]);
      }
      const fits = await player.locator(".demo-stage").evaluate(stage => {
        const bounds = stage.getBoundingClientRect();
        const content = stage.firstElementChild!.getBoundingClientRect();
        return content.bottom <= bounds.bottom + 1;
      });
      expect.soft(fits, `${key} fits vertically`).toBe(true);
      if (key === "tasks") {
        await expect(player.locator('[data-status="done"] [data-demo-result="task-moved"]')).toContainText("HA");
        await expect(player.locator('[data-demo-item="design"]')).toHaveCount(1);
        await expect(player.locator('.lovable-task-stats > div').nth(2)).toContainText("4");
      }
      if (process.env.LANDING_CAPTURE === "1" && key === "tasks") {
        const dir = resolve(import.meta.dirname, "../.impeccable/review");
        await mkdir(dir, { recursive: true });
        await player.screenshot({ path: resolve(dir, `playback-completed-${width}.png`) });
      }
    }
  });
}

test("storyboards become readable three-step stories at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#du-an");
  for (const key of ["tasks", "meetings", "chat", "ask", "email"]) {
    await selectWorkspaceFeature(page, key, false);
    const story = page.locator(`.mobile-feature-story[data-mobile-feature="${key}"]`);
    await story.scrollIntoViewIfNeeded();
    await expect(story).toBeVisible();
    const steps = story.locator(".mobile-story-steps button");
    await expect(steps).toHaveCount(3);
    const detail = story.locator(".mobile-story-detail");
    const first = await detail.innerText();
    await steps.nth(2).click();
    await expect(steps.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(detail).not.toHaveText(first);
    for (const button of await steps.all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("original UNI wears the shared mark and retains its static fallback", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const character = page.locator('[data-scene="character"]');
  await character.scrollIntoViewIfNeeded();
  const portrait = character.locator(".mascot-portrait");
  await expect(portrait).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  const mark = character.locator(".mascot-shirt-logo svg");
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("viewBox", "0 0 128 92");
  await expect(portrait.locator("img")).toBeAttached();
  await expect(character).toHaveAttribute("data-motion", "paused");
});

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  for (const locale of ["vi", "en"]) {
    test(`scripted views, brand and contrast: ${viewport.name}-${locale}`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "uniwork-locale", value: locale, url: baseURL! }]);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/#platform");
      for (const theme of ["light", "dark"]) {
        await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
        for (const key of Object.values(workspaceGroups).flat()) {
          await selectWorkspaceFeature(page, key, false);
          const player = page.locator(".product-playback");
          if (["tasks", "meetings", "chat", "ask", "email"].includes(key)) {
            await expect(player).toHaveAttribute("data-feature-preview", key);
            await expect(player).toHaveAttribute("data-running", "false");
          } else {
            await expect(player).toHaveCount(0);
          }
          await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          expect.soft((await auditText(page)).fails).toEqual([]);
          if (process.env.LANDING_CAPTURE === "1" && locale === "vi" && theme === "light" && ["tasks", "meetings", "documents", "email"].includes(key)) {
            const dir = resolve(import.meta.dirname, "../.impeccable/review");
            await mkdir(dir, { recursive: true });
            await page.locator("#platform").screenshot({ path: resolve(dir, `playback-${viewport.name}-${key}.png`), style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
          }
        }
      }
      if (process.env.LANDING_CAPTURE === "1" && locale === "vi") {
        await page.locator(".horse-mascot").scrollIntoViewIfNeeded();
        await page.locator(".horse-mascot").screenshot({ path: resolve(import.meta.dirname, `../.impeccable/review/branded-horse-${viewport.name}.png`), style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
      }
    });
  }
}
