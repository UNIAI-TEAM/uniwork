import { expect, test, type Page } from "@playwright/test";
import { VERIFICATION_CODE } from "./auth-nav";
import { inviteFromSettings, joinInvitation, openInvitation } from "./invitations";
import { VI_LOCALE_STATE } from "./locale-state";
import { onboardToWorkspace, workspaceSeed } from "./onboard";

// One organization per account (ADR 0032, spec 2026-10-13 §8): somebody who
// already belongs to an organization joins another one only through the
// invitation page's switch wizard, and a sole owner closes their organization
// and starts over from /get-started.
//
// Requires a running app (make start, or make start-worktree for this lane).

const stamp = Date.now();

/** Registers under an address that already has an invitation: verification lands on the invitation list. */
async function registerInvitee(page: Page, name: string, email: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/verify$/, { timeout: 15_000 });
  await page.getByLabel("Mã xác thực").fill(VERIFICATION_CODE);
  await expect(page).toHaveURL(/\/invitations$/, { timeout: 15_000 });
}

test.describe("organization switch", () => {
  // Three accounts and two organizations before the first assertion.
  test.describe.configure({ timeout: 240_000 });

  test("a member of A opens B's invitation, leaves A in the wizard and lands in B", async ({ browser }) => {
    const a = workspaceSeed("switch", "a", stamp);
    const b = workspaceSeed("switch", "b", stamp);
    const memberEmail = `switch-member-${stamp}@example.com`;

    const ownerA = await (await browser.newContext({ storageState: VI_LOCALE_STATE })).newPage();
    await onboardToWorkspace(ownerA, a);
    await inviteFromSettings(ownerA, a.orgSlug, a.wsSlug, memberEmail);

    // The member joins A from its invitation page: nothing stands in the way.
    const memberContext = await browser.newContext({ storageState: VI_LOCALE_STATE });
    const member = await memberContext.newPage();
    await registerInvitee(member, "Thanh Vien", memberEmail);
    await joinInvitation(member, a.orgName);
    await expect(member).toHaveURL(new RegExp(`/${a.orgSlug}/${a.wsSlug}/`), { timeout: 20_000 });

    const ownerB = await (await browser.newContext({ storageState: VI_LOCALE_STATE })).newPage();
    await onboardToWorkspace(ownerB, b);
    await inviteFromSettings(ownerB, b.orgSlug, b.wsSlug, memberEmail);

    // B's invitation opens the switch wizard, since the member belongs to A.
    await openInvitation(member, b.orgName);
    await expect(member.getByRole("heading", { name: `Chuyển sang ${b.orgName}` })).toBeVisible({ timeout: 15_000 });
    await expect(member.getByRole("heading", { name: `Bạn đang thuộc ${a.orgName}` })).toBeVisible();
    await member.getByRole("button", { name: "Tiếp tục" }).click();

    // Step 2: a member of A gives it up by leaving; Continue waits for the box.
    await expect(member.getByRole("heading", { name: "Xử lý tổ chức cũ" })).toBeFocused();
    const resolveNext = member.getByRole("button", { name: "Tiếp tục" });
    await expect(resolveNext).toHaveAttribute("aria-disabled", "true");
    await member.getByRole("checkbox", { name: `Tôi muốn rời ${a.orgName}` }).check();
    await resolveNext.click();

    // Step 3: the summary names both sides, and one action does the switch.
    await expect(member.getByRole("heading", { name: "Xác nhận chuyển tổ chức" })).toBeFocused();
    await expect(member.getByText(`Rời ${a.orgName}`)).toBeVisible();
    await member.getByRole("button", { name: `Chuyển sang ${b.orgName}` }).click();
    await expect(member).toHaveURL(new RegExp(`/${b.orgSlug}/${b.wsSlug}/`), { timeout: 20_000 });

    // A is gone from the workspace switcher; only B's workspace is left.
    await member.getByRole("button", { name: new RegExp(`^${b.orgName}, ${b.wsName}: chuyển workspace`) }).click();
    const menu = member.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: b.wsName })).toBeVisible();
    await expect(menu.getByText(a.orgName)).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: a.wsName })).toHaveCount(0);

    await memberContext.close();
    await ownerA.context().close();
    await ownerB.context().close();
  });

  test("a sole owner closes the organization, lands on /get-started and founds a new one", async ({ page }) => {
    const first = workspaceSeed("closing", "first", stamp);
    const next = workspaceSeed("closing", "next", stamp);
    await onboardToWorkspace(page, first);

    await page.goto(`/${first.orgSlug}/${first.wsSlug}/settings?tab=organization`);
    await page.getByRole("button", { name: "Đóng tổ chức" }).click();
    const dialog = page.getByRole("dialog", { name: `Đóng ${first.orgName}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Gõ đường dẫn tổ chức để xác nhận").fill(first.orgSlug);
    await dialog.getByRole("button", { name: "Đóng tổ chức" }).click();

    await expect(page).toHaveURL(/\/get-started$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Bạn chưa thuộc tổ chức nào" })).toBeVisible();

    // A closed organization holds nobody, so creating another one is offered.
    await page.getByRole("link", { name: "Tạo tổ chức" }).click();
    await expect(page).toHaveURL(/\/workspaces\/new$/, { timeout: 15_000 });
    await page.getByLabel("Tên tổ chức").fill(next.orgName);
    await page.getByRole("button", { name: `Tạo ${next.orgName}` }).click();
    await page.getByLabel("Tên workspace").fill(next.wsName);
    await page.getByRole("button", { name: `Tạo ${next.wsName}` }).click();
    await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
    await expect(page).toHaveURL(new RegExp(`/${next.orgSlug}/${next.wsSlug}/tasks`), { timeout: 30_000 });
  });
});
