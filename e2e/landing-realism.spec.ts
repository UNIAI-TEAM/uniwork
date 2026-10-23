import { expect, test } from "@playwright/test";
import { landingReady, gotoLanding } from "./landing-ready";
import { selectWorkspaceFeature } from "./landing-catalog-helpers";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { auditText } from "./contrast";

// The current product panels keep their pending and source states on the stage.
for (const width of [1440, 820]) {
  test(`pending and source destination stay readable at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoLanding(page, "/");
    await landingReady(page);
    await expect(page.locator("#landing-title")).toBeVisible();
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
      // A press that lands before the film hydrates does nothing; press again
      // until it runs, but never press the stop button it turns into.
      await expect(async () => {
        if ((await film.getAttribute("data-running")) !== "true") {
          await page.locator('#product-preview [data-action="toggle-playback"]').click({ timeout: 2_000 });
        }
        await expect(film).toHaveAttribute("data-running", "true", { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await page.clock.runFor(key === "meetings" ? 5400 : 8000);
      await page.locator('#product-preview [data-action="toggle-playback"]').click();
      await expect(film).toHaveAttribute("data-step", key === "meetings" ? "2" : "3");
      expect((await auditText(page)).fails).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.LANDING_CAPTURE === "1") await film.screenshot({ path: resolve(dir, `realism-${key}-${width}.png`), style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
    }
  });
}

test("My tasks scopes and Projects open the current task details", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#platform");
  await landingReady(page);
  await selectWorkspaceFeature(page, "today");
  const panel = page.locator('.preview-main > [role=tabpanel]:not([hidden])');
  await panel.locator('.product-my-tasks-scopes button').first().click();
  await panel.locator('.product-task-open').first().click();
  await expect(panel.locator('.product-task-details')).toBeVisible();
  await selectWorkspaceFeature(page, "projects");
  await panel.getByText('UniWork', { exact: true }).click();
  await panel.locator('.product-current-project-detail').getByRole('button', { name: 'Công việc', exact: true }).click();
  await expect(page.locator('.product-demo-shell')).toHaveAttribute('data-demo-feature', 'tasks');
});

test("chat waits for creation before attaching the task", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#trao-doi");
  await landingReady(page);
  await page.waitForLoadState("networkidle");
  await page.bringToFront();
  const film = page.locator(".product-playback");
  await expect(film).toHaveAttribute("data-feature-preview", "chat");
  await expect(film.locator('.product-chat-stage')).toBeVisible();
  await page.clock.install();
  await page.locator('#product-preview [data-action="toggle-playback"]').click();
  await expect(film).toHaveAttribute("data-running", "true");
  await page.clock.runFor(2700);
  await expect(film).toHaveAttribute("data-step", "1");
  await page.clock.runFor(2700);
  await expect(film).toHaveAttribute("data-step", "2");
  await expect(film.locator(".product-chat-dialog")).toBeVisible();
  await expect(film.locator('[data-demo-result="chat-task"]')).toHaveCount(0);
  await page.clock.runFor(2600);
  await expect(film.locator('[data-demo-pending="create"]')).toBeVisible();
  await page.clock.runFor(2600);
  await expect(film.locator('[data-demo-result="chat-task"]')).toContainText("UNI-22");
  await expect(film.locator(".product-chat-dialog")).toHaveCount(0);
});

test("email keeps the same thread and Ask UNI only opens its cited source", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#email");
  await landingReady(page);
  // Let the shared auth/config Providers settle before freezing demo timers.
  await page.waitForLoadState("networkidle");
  const film = page.locator(".product-playback");
  await expect(film).toHaveAttribute("data-feature-preview", "email");
  await film.scrollIntoViewIfNeeded();
  await page.clock.install();
  await page.locator('#product-preview [data-action="toggle-playback"]').click();
  await expect(film).toHaveAttribute("data-running", "true");
  await page.clock.runFor(2700);
  const subject = await film.locator("#demo-email-subject").innerText();
  await page.clock.runFor(5300);
  await expect(film.locator("#demo-email-subject")).toHaveText(subject);
  await expect(film.locator('[data-demo-result="starred"] [role=toolbar] button[aria-pressed]').first()).toHaveAttribute("aria-pressed", "true");
  await selectWorkspaceFeature(page, "ask", false);
  await page.locator('#product-preview [data-action="toggle-playback"]').click();
  await page.clock.runFor(2700);
  await expect(film.locator(".action-pending")).toBeVisible();
  await expect(film.locator('[data-demo-target="ask-source"] a')).toHaveCount(0);
  await page.clock.runFor(2700);
  await expect(film.locator('[data-demo-target="ask-source"] a')).toContainText("[S1]");
  await page.clock.runFor(2700);
  await expect(film.locator('.product-ask-context [data-demo-detail="task"]')).toContainText("UNI-18");
  await expect(film.locator('.product-ask-context [data-demo-detail="task"]')).toContainText("Đang làm");
});

test("assignment opens details and a member picker without completing the task", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#du-an");
  await landingReady(page);
  // /config settling remounts the landing; installing the clock before that
  // restarts the film mid-sequence.
  await page.waitForLoadState("networkidle");
  const film = page.locator(".product-playback");
  await expect(film.locator(".product-task-stage").first()).toBeVisible();
  await page.clock.install();
  await page.locator('#product-preview [data-action="toggle-playback"]').click();
  await page.clock.runFor(2700);
  await expect(film.locator('[data-demo-detail="task"]')).toBeVisible();
  await expect(film.locator(".product-task-member-menu")).toHaveCount(0);
  await page.clock.runFor(2700);
  await expect(film.locator(".product-task-member-menu")).toBeVisible();
  await page.clock.runFor(2700);
  await expect(film.locator('[data-demo-result="assignee"]')).toContainText("Hoàng Anh");
  await expect(film.locator('[data-demo-detail="task"]')).toContainText("Đang làm");
  await expect(film.locator(".product-task-member-menu")).toHaveCount(0);
});

test("screen sharing needs source selection and confirmation; planned entries never autoplay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#hop");
  await landingReady(page);
  const film = page.locator(".product-playback");
  await expect(film.locator(".product-meeting-stage")).toBeVisible();
  await page.clock.install();
  await expect(film.locator('[data-demo-result="screen"]')).toHaveCount(0);
  await page.locator('#product-preview [data-action="toggle-playback"]').click();
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
