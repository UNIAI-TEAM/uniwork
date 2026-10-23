import { expect, test } from "@playwright/test";
import { inviteToOrganizationFromSettings, openInvitation, switchByClosing } from "./invitations";
import { VI_LOCALE_STATE } from "./locale-state";
import { onboardToWorkspace, workspaceSeed } from "./onboard";

// UNI-1472 / UNI-1582: somebody who founded organization A is invited to
// organization B from B's Settings › Organization, walks the switch wizard
// (closing A, which they own alone) and accepts. They must land in B - in the
// workspace the invitation granted, or on "no workspace yet" when it granted
// none - and never on the create-organization / create-workspace flow.
//
// Requires a running app (make start, or make start-worktree for this lane).

const stamp = Date.now();

test.describe("organization invitation with workspaces", () => {
  // Two accounts and two organizations before the first assertion.
  test.describe.configure({ timeout: 240_000 });

  test("an invitation that grants B's workspace lands the switched person in it", async ({ browser }) => {
    const a = workspaceSeed("orgws", "a", stamp);
    const b = workspaceSeed("orgws", "b", stamp);

    const personA = await (await browser.newContext({ storageState: VI_LOCALE_STATE })).newPage();
    await onboardToWorkspace(personA, a);
    const ownerB = await (await browser.newContext({ storageState: VI_LOCALE_STATE })).newPage();
    await onboardToWorkspace(ownerB, b);
    await inviteToOrganizationFromSettings(ownerB, b.orgSlug, b.wsSlug, a.email, [b.wsName]);
    // The admin's pending list says what the invitation grants.
    await expect(ownerB.getByText(a.email).locator("xpath=ancestor::li[1]")).toContainText(`Vào ${b.wsName}`);

    // The invitee sees where accepting leads before anything changes.
    await openInvitation(personA, b.orgName);
    await switchByClosing(personA, a, b.orgName);
    await expect(personA.getByText(`Vào workspace ${b.wsName}`)).toBeVisible();
    await personA.getByRole("button", { name: `Chuyển sang ${b.orgName}` }).click();

    await expect(personA).toHaveURL(new RegExp(`/${b.orgSlug}/${b.wsSlug}/`), { timeout: 20_000 });
    await expect(personA).not.toHaveURL(/\/workspaces\/new/);

    // The picker lists the granted workspace, not the create flow.
    await personA.goto("/workspaces");
    await expect(personA.getByRole("button", { name: new RegExp(b.wsName) })).toBeVisible({ timeout: 15_000 });
    await expect(personA).toHaveURL(/\/workspaces$/);

    await personA.context().close();
    await ownerB.context().close();
  });

  test("an invitation that grants no workspace lands a member on 'no workspace yet', not on create", async ({ browser }) => {
    const a = workspaceSeed("orgws0", "a", stamp);
    const b = workspaceSeed("orgws0", "b", stamp);

    const personA = await (await browser.newContext({ storageState: VI_LOCALE_STATE })).newPage();
    await onboardToWorkspace(personA, a);
    const ownerB = await (await browser.newContext({ storageState: VI_LOCALE_STATE })).newPage();
    await onboardToWorkspace(ownerB, b);
    await inviteToOrganizationFromSettings(ownerB, b.orgSlug, b.wsSlug, a.email, []);
    await expect(ownerB.getByText(a.email).locator("xpath=ancestor::li[1]")).toContainText("Chưa cấp workspace");

    await openInvitation(personA, b.orgName);
    await switchByClosing(personA, a, b.orgName);
    await personA.getByRole("button", { name: `Chuyển sang ${b.orgName}` }).click();

    await expect(personA).toHaveURL(/\/no-workspace$/, { timeout: 20_000 });
    await expect(personA.getByRole("heading", { name: "Bạn chưa được cấp workspace" })).toBeVisible();
    await expect(personA.getByText(`Bạn đã tham gia ${b.orgName}`)).toBeVisible();
    await expect(personA.getByRole("link", { name: "Tạo workspace" })).toHaveCount(0);

    // The picker and the create flow both hand a member back here.
    await personA.goto("/workspaces");
    await expect(personA).toHaveURL(/\/no-workspace$/, { timeout: 15_000 });
    await personA.goto("/workspaces/new");
    await expect(personA).toHaveURL(/\/no-workspace$/, { timeout: 15_000 });

    await personA.context().close();
    await ownerB.context().close();
  });
});
