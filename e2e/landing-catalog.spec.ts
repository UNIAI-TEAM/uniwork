import { openManualPreview, workspaceGroups } from "./landing-catalog-helpers";
import { expect, test } from "@playwright/test";

test("catalog covers 25 reference entries without implying illustrations are working modules", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#platform");
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(stage.locator(".workspace-group-button")).toHaveCount(6);
  expect(Object.values(workspaceGroups).flat()).toHaveLength(25);
  const illustrations = ["calendar", "workflows", "outputs", "documents", "approvals", "knowledge", "automation", "agents", "ai-brain", "skills", "work-catalog", "decisions", "decision-history", "ai-market", "reports"];
  for (const [group, features] of Object.entries(workspaceGroups)) {
    await stage.locator(`[data-feature-group="${group}"]`).click();
    for (const key of features) {
      await stage.locator(`[role=tab][data-feature="${key}"]`).click();
      await expect(stage.getByRole("tabpanel")).toHaveCount(1);
      if (illustrations.includes(key)) {
        await expect(stage.locator(`[data-feature="${key}"] .workspace-preview-kind`)).toHaveText("Minh họa");
        await expect(stage.getByRole("tabpanel").locator(".lovable-preview-tools")).toContainText("Không thay đổi dữ liệu thật");
        await expect(stage.locator(".product-playback")).toHaveCount(0);
      }
      await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test("project and organization previews work locally and source links stay within the showcase", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#du-an-tong-quan");
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(stage.locator('[data-feature="projects"]')).toHaveAttribute("aria-selected", "true");
  await stage.getByRole("button", { name: "Xem công việc", exact: true }).click();
  await expect(stage.locator('[data-feature="tasks"]')).toBeFocused();
  await stage.locator('[data-feature-group="organization"]').click();
  await stage.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(stage.locator(".organization-preview")).toContainText("Quyền trong workspace");
  await stage.locator('[data-feature="audit"]').click();
  await stage.getByRole("button", { name: /task.updated/ }).click();
  await expect(stage.locator(".audit-example-detail")).toContainText("human");
});
