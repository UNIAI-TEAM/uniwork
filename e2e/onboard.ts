import { expect, type Page } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

/**
 * Shared register -> verify -> create-org -> create-workspace -> skip-invite
 * flow for specs that need a fresh account inside a fresh workspace.
 *
 * The slug assertions rely on the onboarding form deriving slugs from the
 * org/workspace names, so callers keep names ASCII and pass the expected
 * slugs alongside.
 */
export interface WorkspaceSeed {
  name: string;
  email: string;
  orgName: string;
  wsName: string;
  orgSlug: string;
  wsSlug: string;
}

/** Names stay ASCII so the slugs the onboarding form derives are predictable. */
export function workspaceSeed(tag: string, label: string, stamp: number): WorkspaceSeed {
  const display = tag[0].toUpperCase() + tag.slice(1);
  return {
    name: `${display} ${label}`,
    email: `${tag}-${label}-${stamp}@example.com`,
    orgName: `${display} ${label} ${stamp}`,
    wsName: `Team ${label} ${stamp}`,
    orgSlug: `${tag}-${label}-${stamp}`,
    wsSlug: `team-${label}-${stamp}`,
  };
}

export async function onboardToWorkspace(page: Page, w: WorkspaceSeed): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(w.name);
  await page.getByLabel("Email").fill(w.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(w.orgName);
  await page.getByRole("button", { name: `Tạo ${w.orgName}` }).click();
  await page.getByLabel("Tên workspace").fill(w.wsName);
  await page.getByRole("button", { name: `Tạo ${w.wsName}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${w.orgSlug}/${w.wsSlug}/tasks`), { timeout: 60_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 30_000 });
}
