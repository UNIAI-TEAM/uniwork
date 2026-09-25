import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";

for (const sample of [
  { width: 1440, locale: "vi", theme: "light" },
  { width: 768, locale: "vi", theme: "light" },
  // Phones show the three-step story, not the film; dark/en is covered on tablet.
  { width: 820, locale: "en", theme: "dark" },
] as const) {
  test(`click leads a continuous card move: ${sample.width}-${sample.theme}`, async ({ page, context, baseURL }) => {
    // Faked clock ticks also drive the 3D core and scroll ticker; the scripted run
    // needs minutes of wall time on a dev server.
    test.setTimeout(240_000);
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.theme });
    await page.goto("/#du-an");
    await page.waitForLoadState("networkidle");
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), sample.theme);
    const player = page.locator(".product-playback");
    await player.scrollIntoViewIfNeeded();
    await expect(player).toHaveAttribute("data-step", "0");
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      Element.prototype.animate = function (...args: Parameters<typeof original>) {
        if (this instanceof HTMLElement && this.dataset.demoItem) {
          this.dataset.observedMotion = JSON.stringify(args[0]);
        }
        return original.apply(this, args);
      };
    });
    await page.clock.install({ time: new Date("2026-09-24T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-09-24T00:00:01Z"));
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: sample.theme });
    // Changing the preference rebuilds the landing scroll-reveal context.
    await page.bringToFront();
    await player.scrollIntoViewIfNeeded();
    await expect(player).toBeInViewport({ ratio: .5 });
    await expect(player).toHaveAttribute("data-running", "true");
    await page.clock.runFor(2360);
    await expect(player).toHaveAttribute("data-pressing", "true");
    await expect(player).toHaveAttribute("data-step", "0");
    await expect(player.locator(".action-click-ring")).toHaveCSS("animation-name", "demo-click-ring");
    await expect(player.locator('[data-demo-pointed="true"]')).toHaveCSS("outline-style", "solid");
    const pause = player.locator("[data-action='toggle-playback']");
    await pause.focus();
    await page.keyboard.press("Enter");
    await expect(player).toHaveAttribute("data-running", "false");
    await page.clock.runFor(4000);
    await expect(player).toHaveAttribute("data-step", "0");
    await page.keyboard.press("Enter");
    await expect(player).toHaveAttribute("data-running", "true");
    await page.clock.runFor(240);
    await expect(player).toHaveAttribute("data-step", "1");
    for (let beat = 2; beat <= 6; beat++) {
      await page.clock.runFor(2600);
      await expect(player).toHaveAttribute("data-step", String(beat));
      if (beat === 3) {
        await expect(player.locator('[data-demo-result="assignee"]')).toContainText("Hoàng Anh");
        await expect(player.locator('[data-demo-detail="task"]')).toContainText("in_progress");
      }
      if (beat === 5) {
        await player.screenshot({ path: `.impeccable/review/action-click-${sample.width}-${sample.theme}.png`, animations: "disabled" });
        const clipped = await player.locator(".action-stage").evaluate(stage => {
          const b = stage.getBoundingClientRect();
          return [...stage.querySelectorAll(".action-cursor-label, .action-status-menu, .action-board-card")].filter(element => {
            const r = element.getBoundingClientRect();
            return r.width && (r.left < b.left || r.right > b.right + 1 || r.top < b.top || r.bottom > b.bottom + 1);
          }).map(element => element.className);
        });
        expect(clipped).toEqual([]);
      }
    }
    const moved = player.locator('[data-status="done"] [data-demo-item="design"]');
    await expect(moved).toContainText("HA");
    await expect(moved).toHaveAttribute("data-demo-result", "task-moved");
    const keyframes = JSON.parse((await moved.getAttribute("data-observed-motion"))!);
    expect(keyframes[0].transform).not.toBe("translate(0px, 0px)");
    expect(keyframes[1].transform).toBe("translate(0, 0)");
    await expect(player.locator('[data-demo-item="design"]')).toHaveCount(1);
    await expect(player.locator('.lovable-task-stats > div').nth(2)).toContainText("4");
    await player.locator("[data-action='toggle-playback']").click();
    await expect(player).toHaveAttribute("data-running", "false");
    expect(await player.locator(".action-stage").evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
    await player.screenshot({ path: `.impeccable/review/action-moved-${sample.width}-${sample.theme}.png`, animations: "disabled" });
    await expect(page.locator("html")).toHaveClass(sample.theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await auditText(page)).fails).toEqual([]);
  });
}

test("reduced motion keeps click results without spatial effects", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#du-an");
  await page.waitForLoadState("networkidle");
  const player = page.locator(".product-playback");
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-running", "false");
  await expect(player.locator(".action-cursor")).toBeHidden();
  await page.clock.install();
  await player.locator("[data-action='toggle-playback']").click();
  await expect(player).toHaveAttribute("data-running", "true");
  for (let beat = 1; beat <= 6; beat++) {
    await page.clock.runFor(2600);
    await expect(player).toHaveAttribute("data-step", String(beat));
  }
  await expect(player.locator('[data-status="done"] [data-demo-result="task-moved"]')).toBeVisible();
  const spatial = await player.locator(".action-stage").evaluate(element =>
    element.getAnimations({ subtree: true }).filter(animation =>
      animation.playState === "running" && animation.effect instanceof KeyframeEffect &&
      animation.effect.getKeyframes().some(frame => frame.transform && frame.transform !== "none"),
    ).length,
  );
  expect(spatial).toBe(0);
});
