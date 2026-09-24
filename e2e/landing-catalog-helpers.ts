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
  const stage = page.locator("#product-preview");
  if (await stage.getAttribute("data-presentation") === "watch") await stage.locator('[data-action="toggle-presentation"]').click();
}

export async function selectWorkspaceFeature(page: Page, key: string, manual = true) {
  const entry = Object.entries(workspaceGroups).find(([, values]) => (values as readonly string[]).includes(key));
  if (!entry) throw new Error(`Unknown workspace feature: ${key}`);
  const stage = page.locator("#product-preview");
  if (manual) await openManualPreview(page);
  await stage.locator(`[data-feature-group="${entry[0]}"]`).click();
  await stage.locator(`[role=tab][data-feature="${key}"]`).click();
}
