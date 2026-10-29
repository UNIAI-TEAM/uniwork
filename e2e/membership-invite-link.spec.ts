import { expect, test, type Page } from "@playwright/test";
import { VERIFICATION_CODE } from "./auth-nav";
import { VI_LOCALE_STATE } from "./locale-state";
import { onboardToWorkspace, workspaceSeed } from "./onboard";

/**
 * UNI-2226: shareable workspace invite link. Owner creates the link in
 * Settings › Members; a second account with no organization opens /join/…
 * and lands in the workspace — including when they still need to register.
 */
test.describe("membership invite link", () => {
  test.describe.configure({ timeout: 240_000 });

  async function createWorkspaceInviteLink(owner: Page, orgSlug: string, wsSlug: string) {
    await owner.goto(`/${orgSlug}/${wsSlug}/settings?tab=members`);
    await expect(owner.getByRole("heading", { name: "Mời bằng liên kết" })).toBeVisible({ timeout: 15_000 });
    await owner.getByRole("button", { name: "Tạo liên kết" }).click();
    await expect(owner.getByRole("button", { name: /Sao chép liên kết|Đã sao chép liên kết/ })).toBeVisible({
      timeout: 15_000,
    });
    const linkText = await owner.locator("span.text-caption").filter({ hasText: "/join/" }).first().innerText();
    const match = linkText.match(/\/join\/([^#\s]+)#secret=([^\s]+)/);
    expect(match).toBeTruthy();
    return { linkId: match![1], secret: match![2] };
  }

  test("a workspace invite link joins someone with no organization", async ({ browser }) => {
    const stamp = Date.now();
    const ownerSeed = workspaceSeed("mil", "owner", stamp);

    const owner = await (await browser.newContext({ storageState: VI_LOCALE_STATE })).newPage();
    await onboardToWorkspace(owner, ownerSeed);
    const { linkId, secret } = await createWorkspaceInviteLink(owner, ownerSeed.orgSlug, ownerSeed.wsSlug);

    // Unregistered: /join → login?next= → register → verify → back to /join → join org.
    const invitee = await (await browser.newContext({ storageState: VI_LOCALE_STATE })).newPage();
    await invitee.goto(`/join/${linkId}#secret=${secret}`);
    await expect(invitee).toHaveURL(/\/login\?next=/, { timeout: 15_000 });
    await invitee.getByRole("link", { name: "Đăng ký" }).click();
    await expect(invitee).toHaveURL(/\/register\?next=/, { timeout: 15_000 });

    const email = `mil-join-${stamp}@example.com`;
    await invitee.getByLabel("Tên hiển thị").fill("mil-join");
    await invitee.getByLabel("Email").fill(email);
    await invitee.getByLabel("Mật khẩu", { exact: true }).fill("password123");
    await invitee.getByRole("button", { name: "Đăng ký" }).click();
    await expect(invitee).toHaveURL(/\/verify\?next=/, { timeout: 15_000 });
    await invitee.getByLabel("Mã xác thực").fill(VERIFICATION_CODE);
    await expect(invitee).toHaveURL(new RegExp(`/join/${linkId}`), { timeout: 20_000 });

    await expect(invitee.getByRole("heading", { name: new RegExp(`Tham gia ${ownerSeed.orgName}`) })).toBeVisible({
      timeout: 20_000,
    });
    await invitee.getByRole("button", { name: "Tham gia", exact: true }).click();
    // The join lands on the workspace root (Home), which has no trailing slash.
    await expect(invitee).toHaveURL(new RegExp(`/${ownerSeed.orgSlug}/${ownerSeed.wsSlug}/?$`), { timeout: 20_000 });

    await owner.context().close();
    await invitee.context().close();
  });
});
