import { expect, type Page } from "@playwright/test";

/**
 * Invites one address into the workspace from Settings › Members. The page
 * must belong to an admin of that workspace.
 */
export async function inviteFromSettings(page: Page, orgSlug: string, wsSlug: string, email: string): Promise<void> {
  // Members live under Settings; /members is only a client-side redirect there,
  // and typing into the form before it lands loses the address.
  await page.goto(`/${orgSlug}/${wsSlug}/settings?tab=members`);
  await expect(page.getByRole("heading", { name: "Mời vào workspace" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Email đồng nghiệp").fill(email);
  await page.getByLabel("Email đồng nghiệp").press("Enter");
  await page.getByRole("button", { name: "Mời thành viên" }).click();
  await expect(page.getByText(/Đã gửi 1 lời mời/).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Opens an organization's invitation from the pending list. Every row links
 * to the invitation's own page (spec 2026-10-13 §6.2), which shows what
 * joining means before anything changes.
 */
export async function openInvitation(page: Page, organizationName: string): Promise<void> {
  await page.goto("/invitations");
  await page.getByRole("link", { name: `Xem lời mời vào ${organizationName}` }).click();
  await expect(page).toHaveURL(/\/invite\/[^/]+$/, { timeout: 15_000 });
}

/**
 * Joins from the list for someone who belongs to no organization yet: the
 * invitation page shows a plain card with one "Tham gia".
 */
export async function joinInvitation(page: Page, organizationName: string): Promise<void> {
  await openInvitation(page, organizationName);
  await expect(page.getByRole("heading", { name: `Tham gia ${organizationName}` })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Tham gia", exact: true }).click();
}
