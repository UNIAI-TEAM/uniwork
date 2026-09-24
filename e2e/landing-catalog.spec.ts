import { openManualPreview } from "./landing-catalog-helpers";
import { expect, test } from "@playwright/test";

test("catalog covers the six product families without implying planned modules are shipped", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#platform");
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(stage.locator(".workspace-group-button")).toHaveCount(6);
  const groups = [
    { key: "work", features: ["dashboard", "tasks", "projects", "today", "calendar", "workflows"] },
    { key: "communication", features: ["meetings", "chat", "email"] },
    { key: "results", features: ["outputs", "documents", "approvals"] },
    { key: "knowledge", features: ["knowledge"] },
    { key: "ai", features: ["ask", "agents", "automation"] },
    { key: "organization", features: ["organization", "audit"] },
  ];
  const planned = ["calendar", "workflows", "outputs", "documents", "approvals", "knowledge", "automation"];
  for (const group of groups) {
    await stage.locator(`[data-feature-group="${group.key}"]`).click();
    for (const key of group.features) {
      await stage.locator(`[role=tab][data-feature="${key}"]`).click();
      await expect(stage.getByRole("tabpanel")).toHaveCount(1);
      if (planned.includes(key)) await expect(stage.getByRole("tabpanel").locator(".planned-notice")).toContainText("Chưa triển khai");
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
