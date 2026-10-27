import { openManualPreview, selectWorkspaceFeature, workspaceGroups } from "./landing-catalog-helpers";
import { expect, test } from "@playwright/test";
import { landingReady, gotoLanding } from "./landing-ready";

test("catalog covers 25 reference entries without implying illustrations are working modules", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#platform");
  await landingReady(page);
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(stage.locator(".product-demo-shell")).toBeVisible();
  expect(Object.values(workspaceGroups).flat()).toHaveLength(25);
  const illustrations = ["workflows", "outputs", "approvals", "knowledge", "automation", "agents", "ai-brain", "skills", "work-catalog", "decisions", "decision-history", "ai-market", "reports"];
  for (const key of Object.values(workspaceGroups).flat()) {
    await selectWorkspaceFeature(page, key);
    await expect(stage.locator("[role=tabpanel]")).toHaveCount(1);
    await expect(stage.locator(`.product-demo-shell[data-demo-feature="${key}"]`)).toHaveCount(1);
    if (illustrations.includes(key)) {
      // Features without a current screen stay a labelled illustration, not a working module.
      await expect(stage.locator(`.lovable-canvas[data-lovable-screen="${key}"]`)).toHaveAttribute("aria-label", /Dữ liệu hư cấu minh họa/);
      await expect(stage.locator(".product-playback")).toHaveCount(0);
    }
    await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("project and organization previews work locally and source links stay within the showcase", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#du-an-tong-quan");
  await landingReady(page);
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await selectWorkspaceFeature(page, "projects");
  await expect(stage.locator(".product-current-projects")).toBeVisible();
  await expect(stage).toContainText("Demo Studio");
  await selectWorkspaceFeature(page, "organization");
  await expect(stage.locator(".product-current-people")).toBeVisible();
  await expect(stage.locator(".product-current-people a[href^='/people/']")).toHaveCount(3);
  await selectWorkspaceFeature(page, "audit");
  await expect(stage.locator(".audit-example-detail")).toContainText("human");
  await expect(stage.locator(".audit-example-detail")).toContainText("task.updated");
});
