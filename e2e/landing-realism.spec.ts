import { expect, test } from "@playwright/test";
import { openManualPreview, selectWorkspaceFeature } from "./landing-catalog-helpers";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { auditText } from "./contrast";

for (const width of [1440, 390]) {
  test(`pending and source destination stay readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(".scene-canvas")).toHaveAttribute("data-rendered", "true");
    const dir = resolve(import.meta.dirname, "../.impeccable/review");
    if (process.env.LANDING_CAPTURE === "1") {
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: resolve(dir, `realism-hero-${width}.png`) });
    }
    await page.clock.install();
    for (const key of ["chat", "ask", "meetings"]) {
      await selectWorkspaceFeature(page, key, false);
      const film = page.locator(".product-playback");
      await film.scrollIntoViewIfNeeded();
      await film.getByRole("button", { name: "Phát demo", exact: true }).click();
      await expect(film).toHaveAttribute("data-running", "true");
      await page.clock.runFor(key === "meetings" ? 5400 : 8000);
      await film.getByRole("button", { name: "Dừng demo", exact: true }).click();
      await expect(film).toHaveAttribute("data-step", key === "meetings" ? "2" : "3");
      expect((await auditText(page)).fails).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.LANDING_CAPTURE === "1") await film.screenshot({ path: resolve(dir, `realism-${key}-${width}.png`), style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
    }
  });
}

test("Today and Projects task links open manual details even on direct entry", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#daily-tools");
  await page.waitForLoadState("networkidle");
  await openManualPreview(page);
  await page.locator(".today-summary button").first().click();
  await expect(page.locator("#product-preview")).toHaveAttribute("data-presentation", "explore");
  await expect(page.locator(".preview-selection")).toContainText("onboarding");
  await page.goto("/#daily-tools");
  await openManualPreview(page);
  await page.locator(".today-summary button").last().click();
  await expect(page.locator("#product-preview")).toHaveAttribute("data-presentation", "explore");
  await expect(page.locator(".meeting-room")).toBeVisible();
  await page.goto("/#du-an-tong-quan");
  await openManualPreview(page);
  await page.locator(".catalog-preview").getByRole("button", { name: /công việc/i }).click();
  await expect(page.locator("#product-preview")).toHaveAttribute("data-presentation", "explore");
});

test("chat waits for creation before attaching the task", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#trao-doi");
  const film = page.locator(".product-playback");
  await page.clock.install();
  await film.getByRole("button", { name: "Phát demo", exact: true }).click();
  await page.clock.runFor(5400);
  await expect(film.locator(".action-create-dialog")).toBeVisible();
  await expect(film.locator('[data-demo-result="chat-task"]')).toHaveCount(0);
  await page.clock.runFor(2600);
  await expect(film.locator('[data-demo-pending="create"]')).toBeVisible();
  await page.clock.runFor(2600);
  await expect(film.locator('[data-demo-result="chat-task"]')).toContainText("UW-105 · todo");
  await expect(film.locator(".action-create-dialog")).toHaveCount(0);
});

test("email keeps the same thread and Ask UNI only opens its cited source", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#email");
  // Let the shared auth/config Providers settle before freezing demo timers.
  await page.waitForLoadState("networkidle");
  const film = page.locator(".product-playback");
  await expect(film).toHaveAttribute("data-feature-preview", "email");
  await film.scrollIntoViewIfNeeded();
  await page.clock.install();
  await film.getByRole("button", { name: "Phát demo", exact: true }).click();
  await expect(film).toHaveAttribute("data-running", "true");
  await page.clock.runFor(2700);
  const subject = await film.locator(".action-mail-reader h3").innerText();
  await page.clock.runFor(5300);
  await expect(film.locator(".action-mail-reader h3")).toHaveText(subject);
  await expect(film.locator('[data-demo-result="starred"] svg')).toHaveAttribute("data-starred", "true");
  await selectWorkspaceFeature(page, "ask", false);
  await film.getByRole("button", { name: "Phát demo", exact: true }).click();
  await page.clock.runFor(2700);
  await expect(film.locator(".action-pending")).toBeVisible();
  await expect(film.locator(".action-citation")).toHaveCount(0);
  await page.clock.runFor(2700);
  await expect(film.locator(".action-citation")).toContainText("[S1]");
  await page.clock.runFor(2700);
  await expect(film.locator('[data-demo-result="source"]')).toContainText("Hoàng Anh");
  await expect(film.locator('[data-demo-result="source"]')).toContainText("in_progress");
});

test("assignment opens details and a member picker without completing the task", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#du-an");
  const film = page.locator(".product-playback");
  await expect(film.locator(".action-stage")).toBeVisible();
  await page.clock.install();
  await film.getByRole("button", { name: "Phát demo", exact: true }).click();
  await page.clock.runFor(2700);
  await expect(film.locator('[data-demo-detail="task"]')).toBeVisible();
  await expect(film.locator(".action-member-picker")).toHaveCount(0);
  await page.clock.runFor(2700);
  await expect(film.locator(".action-member-picker")).toBeVisible();
  await page.clock.runFor(2700);
  await expect(film.locator('[data-demo-result="assignee"]')).toContainText("Hoàng Anh");
  await expect(film.locator('[data-demo-detail="task"]')).toContainText("in_progress");
  await expect(film.locator(".action-member-picker")).toHaveCount(0);
});

test("screen sharing needs source selection and confirmation; planned entries never autoplay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#hop");
  const film = page.locator(".product-playback");
  await expect(film.locator(".action-stage")).toBeVisible();
  await page.clock.install();
  await expect(film.locator('[data-demo-result="screen"]')).toHaveCount(0);
  await film.getByRole("button", { name: "Phát demo", exact: true }).click();
  await page.clock.runFor(2700);
  await expect(film.locator(".action-source-picker")).toBeVisible();
  await page.clock.runFor(2700);
  await expect(film.locator('[data-demo-target="share-confirm"]')).toHaveAttribute("data-enabled", "true");
  await page.clock.runFor(2700);
  await expect(film.locator('[data-demo-result="screen"]')).toBeVisible();
  await expect(film.locator(".action-source-picker")).toHaveCount(0);
  for (const key of ["documents", "calendar", "automation", "agents"]) {
    await selectWorkspaceFeature(page, key, false);
    await expect(page.locator(".product-playback")).toHaveCount(0);
  }
});
