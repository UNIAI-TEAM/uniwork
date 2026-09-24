import type { Page } from "@playwright/test";

export const workspaceGroups = {
  work: ["dashboard", "tasks", "projects", "today", "calendar", "workflows"],
  communication: ["meetings", "chat", "email"],
  results: ["outputs", "documents", "approvals", "decisions", "decision-history"],
  knowledge: ["knowledge"],
  ai: ["ask", "agents", "automation", "ai-brain", "skills", "work-catalog", "ai-market"],
  organization: ["organization", "audit", "reports"],
} as const;

export async function openManualPreview(page: Page) {
  // Auth/config settlement remounts the landing; wait before toggling local state.
  await page.waitForLoadState("networkidle");
  const stage = page.locator("#product-preview");
  if (await stage.getAttribute("data-presentation") !== "watch") return;
  const toggle = stage.locator('[data-action="toggle-presentation"]');
  if (await toggle.count()) {
    await toggle.click();
    return;
  }
  // Static illustrations have no mode switch; enter exploration through Tasks.
  const selected = await stage.locator('[role=tab][aria-selected=true]').getAttribute("data-feature");
  await selectWorkspaceFeature(page, "tasks", false);
  await toggle.click();
  if (selected) await selectWorkspaceFeature(page, selected, false);
}

export async function selectWorkspaceFeature(page: Page, key: string, manual = true) {
  const entry = Object.entries(workspaceGroups).find(([, values]) => (values as readonly string[]).includes(key));
  if (!entry) throw new Error(`Unknown workspace feature: ${key}`);
  const stage = page.locator("#product-preview");
  await stage.locator(`[data-feature-group="${entry[0]}"]`).click();
  await stage.locator(`[role=tab][data-feature="${key}"]`).click();
  if (manual) await openManualPreview(page);
}
