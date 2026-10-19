import { expect, test, type Page } from "@playwright/test";
import {
  buildShareScene,
  docPath,
  grantAccess,
  inboxOf,
  openSession,
  ownerDoc,
  signInOwner,
  userItem,
  type ShareScene,
} from "./documents-share-fixtures";
import { VI_LOCALE_STATE } from "./locale-state";

// UNI-1968 end-to-end (web half): the owner's post-save hint for mentions
// that cannot view the page, and the reader's ?mention=1 deep link from the
// inbox row. Needs Postgres + Redis + the worktree app on E2E_BASE_URL — the
// same recipe as e2e/documents-share.spec.ts. The spec is new; do not run it
// in this worker (cloud round owns the first run).

test.describe.configure({ mode: "serial" });
test.use({ storageState: VI_LOCALE_STATE });

let scene: ShareScene;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(300_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  scene = await buildShareScene(page, "bmn", 1);
  await context.close();
});

/** Type a mention for `name` into the open page editor. */
async function mention(page: Page, name: string) {
  const editor = page.getByRole("textbox", { name: "Nội dung tài liệu" });
  await editor.click();
  await page.keyboard.type(`@${name}`);
  const row = page.getByRole("button", { name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
}

test("owner mentions a member without view, gets the hint, and sharing clears it", async ({ page }) => {
  // A restricted page: member has no level; extras[0] is granted view first so
  // the save notifies her but not member — the hint must name member alone.
  const { id: docId } = await ownerDoc(page.request, scene, "hint");
  await grantAccess(page.request, scene.m.aOwner.token, docId, [userItem(scene.extras[0]!, "view")]);

  await signInOwner(page, scene);
  await page.goto(docPath(scene.m.aOwner, docId));
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });

  await mention(page, scene.extras[0]!.name);
  await mention(page, scene.member.name);

  // The save is acknowledged on its own; the hint names only the member who
  // cannot view.
  const hint = page.getByTestId("document-body-mention-notice");
  await expect(hint).toBeVisible({ timeout: 30_000 });
  await expect(hint).toContainText(`${scene.member.name} chưa xem được tài liệu này nên đã không nhận thông báo.`);
  await expect(hint).not.toContainText(scene.extras[0]!.name);

  // "Chia sẻ quyền Xem" grants view and the hint closes.
  await hint.getByRole("button", { name: "Chia sẻ quyền Xem" }).click();
  await expect(hint).not.toBeVisible({ timeout: 30_000 });
});

test("the mentioned member's inbox row deep-links to the document at her mention", async ({ page, browser }) => {
  const { id: docId } = await ownerDoc(page.request, scene, "deeplink");
  // Member can view from the start, so the body mention notifies her.
  await grantAccess(page.request, scene.m.aOwner.token, docId, [userItem(scene.member, "view")]);

  await signInOwner(page, scene);
  await page.goto(docPath(scene.m.aOwner, docId));
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await mention(page, scene.member.name);
  // The viewer-only mention produces no owner hint. Wait on the save state
  // itself — not a fixed sleep — then let the notification poll stretch the
  // window before asserting the hint stayed hidden.
  await expect(page.getByRole("status", { name: /^Đã lưu/ })).toBeVisible({ timeout: 30_000 });

  // The member got a document_body_mentioned row for this document.
  await expect
    .poll(
      async () =>
        (await inboxOf(page.request, scene.member.token)).some(
          (n) => n.kind === "document_body_mentioned" && n.resource_id === docId,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(page.getByTestId("document-body-mention-notice")).not.toBeVisible();

  const member = await openSession(browser, scene.member.email);
  const memberPage = member.page;
  await memberPage.goto(`/${scene.m.aOwner.orgSlug}/${scene.m.aOwner.wsSlug}/inbox`);
  // The inbox holds a document_shared row and a document_body_mentioned row
  // per test document — all named by the owner — so the row is found by the
  // mention deep link for THIS document, not by the sender's name.
  const row = memberPage.locator(`a[href*="documents/${docId}?mention=1"]`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();

  // The document opens on her own mention — selected, so the reveal marker is
  // there even once the two-second flash has faded — and the URL drops the
  // parameter after use. The pathname check ignores any other query params.
  const chip = memberPage.locator(`.mention[data-mention-id="${scene.member.id}"]`);
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await expect(memberPage.locator("[data-node-view-wrapper].ProseMirror-selectednode")).toHaveCount(1, { timeout: 15_000 });
  await memberPage.waitForURL((url) => url.pathname.endsWith(`/${docId}`), { timeout: 30_000 });

  await member.context.close();
});
