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
 * joining means before anything changes. A row into a workspace is named
 * "Xem lời mời vào <workspace> trong <organization>", one into the
 * organization itself "Xem lời mời vào <organization>": both end on the
 * organization's name.
 */
export async function openInvitation(page: Page, organizationName: string): Promise<void> {
  await page.goto("/invitations");
  const name = new RegExp(`^Xem lời mời vào (?:.+ trong )?${organizationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  await page.getByRole("link", { name }).click();
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

/**
 * Invites one address into the organization from Settings › Organization,
 * granting the workspaces named (UNI-1582); none leaves the invitee in the
 * organization with no workspace. The page must belong to an owner or admin.
 */
export async function inviteToOrganizationFromSettings(
  page: Page,
  orgSlug: string,
  wsSlug: string,
  email: string,
  workspaces: string[],
): Promise<void> {
  await page.goto(`/${orgSlug}/${wsSlug}/settings?tab=organization`);
  await expect(page.getByRole("heading", { name: "Mời vào tổ chức" })).toBeVisible({ timeout: 15_000 });
  const picker = page.getByRole("group", { name: "Vào workspace" });
  for (const name of workspaces) await picker.getByRole("checkbox", { name }).check();
  await page.getByLabel("Email đồng nghiệp").fill(email);
  await page.getByLabel("Email đồng nghiệp").press("Enter");
  await page.getByRole("button", { name: "Gửi lời mời" }).click();
  await expect(page.getByText(/Đã gửi 1 lời mời/).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Walks the switch wizard for the sole owner of an organization: closing it
 * is the one way out (ADR 0032), confirmed by typing its slug.
 */
export async function switchByClosing(page: Page, from: { orgName: string; orgSlug: string }, toName: string): Promise<void> {
  await expect(page.getByRole("heading", { name: `Chuyển sang ${toName}` })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.getByRole("heading", { name: "Xử lý tổ chức cũ" })).toBeFocused();
  await page.getByLabel("Gõ định danh tổ chức để xác nhận").fill(from.orgSlug);
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.getByRole("heading", { name: "Xác nhận chuyển tổ chức" })).toBeFocused();
  await expect(page.getByText(`Đóng ${from.orgName}`)).toBeVisible();
}
