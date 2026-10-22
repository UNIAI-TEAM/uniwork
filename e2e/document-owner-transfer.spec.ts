import { expect, test, type APIRequestContext, type APIResponse, type Locator, type Page } from "@playwright/test";
import {
  api,
  authHeaders,
  buildShareScene,
  inboxOf,
  levelOf,
  openSession,
  openShareDialog,
  ownerDoc,
  sharesOf,
  signInOwner,
  toast,
  who,
  type SharePerson,
  type ShareScene,
} from "./documents-share-fixtures";

/**
 * DOC-06 (UNI-2084, W-DOC06 e2e): handing a document over to another person
 * through the owner-transfer dialog of the Share dialog, on the real stack, no
 * mocks. The owner picks a workspace member, keeps the default "Chỉnh sửa" and
 * confirms; the new owner hears it in the inbox and can transfer again from
 * their own Share dialog, this time keeping no access ("Không giữ quyền"). A
 * person who is in the organization but not in the workspace is not offered,
 * and one who leaves the workspace between picking and confirming gets the
 * inline refusal (422 owner_target_not_member). Setup goes through the API
 * (the scene, the documents, the first hop of the round trip, the removal); the
 * flows run through the UI. Spec:
 * docs/superpowers/specs/2026-10-15-documents-access-addendum.md §2.1, §2.4,
 * §4.2, row DOC6-W01.
 *
 * Needs the runtime of documents-share.spec.ts (FF_DOCUMENTS on, migrations of
 * this worktree applied, Team plan seeded by the fixture scene). Every row it
 * creates carries the scene's unique tag, so nothing is deleted afterwards.
 */
test.describe.configure({ timeout: 360_000 });

const tag = `ot2084-${Date.now().toString(36)}`;
/** The scene's extras: the person who leaves the workspace mid-dialog. */
const LEAVER = 0;

let s: ShareScene;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await browser.newPage();
  try {
    s = await buildShareScene(page, tag, 1);
  } finally {
    await page.close();
  }
});

/** PUT /documents/{id}/owner as `token`; the caller checks the status. */
function putOwner(
  request: APIRequestContext,
  token: string,
  docId: string,
  userId: string,
  previousOwnerLevel: string,
): Promise<APIResponse> {
  return request.put(`${api}/api/v1/documents/${docId}/owner`, {
    headers: authHeaders(token),
    data: { user_id: userId, previous_owner_level: previousOwnerLevel },
  });
}

/** The "document_owner_transferred" notices a person holds for one document. */
async function ownerNotices(request: APIRequestContext, token: string, docId: string) {
  return (await inboxOf(request, token)).filter((n) => n.kind === "document_owner_transferred" && n.resource_id === docId);
}

/** The owner-transfer dialog that opens over the Share dialog. */
function transferDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /^Chuyển quyền sở hữu “/ });
}

/** Share dialog → "Chuyển quyền sở hữu" on the owner row → the transfer dialog. */
async function openTransfer(page: Page, share: Locator): Promise<Locator> {
  await share.getByRole("button", { name: "Chuyển quyền sở hữu", exact: true }).click();
  const dialog = transferDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("combobox", { name: "Chủ sở hữu mới" })).toBeVisible();
  return dialog;
}

/** Types into the "Chủ sở hữu mới" picker; the option list is portalled out of the dialog. */
async function searchTarget(dialog: Locator, query: string): Promise<void> {
  const combo = dialog.getByRole("combobox", { name: "Chủ sở hữu mới" });
  await combo.click();
  await combo.fill(query);
}

async function pickTarget(page: Page, dialog: Locator, person: SharePerson): Promise<void> {
  await searchTarget(dialog, person.name);
  await page.getByRole("option", { name: who(person.name) }).first().click();
  await expect(dialog.getByRole("combobox", { name: "Chủ sở hữu mới" })).toHaveValue(person.name);
}

function confirmButton(dialog: Locator): Locator {
  return dialog.getByRole("button", { name: "Chuyển", exact: true });
}

/** The owner row of the Share dialog: the one line that carries the transfer button. */
function ownerRow(page: Page, share: Locator): Locator {
  return share.getByRole("listitem").filter({
    has: page.getByRole("button", { name: "Chuyển quyền sở hữu", exact: true }),
  });
}

test("DOC6-W01 the owner hands the document over, the new owner hears it and can open the transfer", async ({
  page,
  browser,
  request,
}) => {
  const doc = await ownerDoc(request, s, "DOC6");
  expect(await levelOf(request, s.member.token, doc.id), "private at create: the member sees nothing").toBe("");

  await signInOwner(page, s);
  const share = await openShareDialog(page, s.m.aOwner, doc.id);
  await expect(ownerRow(page, share)).toContainText(s.owner.name);

  // The transfer dialog opens with the default of the user decision: the previous owner keeps Edit.
  const dialog = await openTransfer(page, share);
  await expect(dialog.getByRole("heading", { name: `Chuyển quyền sở hữu “${doc.title}”` })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: `Quyền của ${s.owner.name} sau khi chuyển` })).toContainText(
    "Chỉnh sửa",
  );
  await pickTarget(page, dialog, s.member);
  await confirmButton(dialog).click();

  await toast(page, `Đã chuyển quyền sở hữu cho ${s.member.name}`);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(ownerRow(page, share)).toContainText(s.member.name, { timeout: 30_000 });

  // Server truth: the member is the ACL owner, the previous owner holds Edit through a share row.
  const after = await sharesOf(request, s.owner.token, doc.id);
  expect(after.acl_owner?.user_id).toBe(s.member.id);
  const kept = (after.shares ?? []).filter((r) => r.principal_type === "user" && r.principal_id === s.owner.id);
  expect(kept, "one live row for the previous owner").toHaveLength(1);
  expect(kept[0]?.level).toBe("edit");
  expect(kept[0]?.active).toBe(true);
  expect(await levelOf(request, s.member.token, doc.id)).toBe("manage");

  // The new owner: the notice is born on the outbox, so poll the API, then read it in the inbox.
  const sentence = `${s.owner.name} đã chuyển cho bạn quyền sở hữu tài liệu “${doc.title}”.`;
  await expect.poll(async () => (await ownerNotices(request, s.member.token, doc.id)).length, { timeout: 60_000 }).toBe(1);
  const [notice] = await ownerNotices(request, s.member.token, doc.id);
  expect(notice?.params.actor).toBe(s.owner.name);
  expect(notice?.params.document).toBe(doc.title);
  expect(await ownerNotices(request, s.owner.token, doc.id), "the caller never hears their own transfer").toHaveLength(0);

  const { context: memberContext, page: member } = await openSession(browser, s.member.email);
  try {
    await member.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/inbox`);
    await expect(member.getByText(sentence).first()).toBeVisible({ timeout: 60_000 });

    // And the new owner reaches the same transfer button on their own Share dialog.
    const memberShare = await openShareDialog(member, s.m.aOwner, doc.id);
    await expect(ownerRow(member, memberShare)).toContainText(s.member.name);
    await expect(memberShare.getByRole("button", { name: "Chuyển quyền sở hữu", exact: true })).toBeVisible();
  } finally {
    await memberContext.close();
  }
});

test("DOC6-W01 a person outside the workspace is not offered, one who leaves mid-dialog is refused inline", async ({
  page,
  request,
}) => {
  const doc = await ownerDoc(request, s, "DOC6-refuse");
  const leaver = s.extras[LEAVER]!;

  await signInOwner(page, s);
  const share = await openShareDialog(page, s.m.aOwner, doc.id);
  const dialog = await openTransfer(page, share);

  // In the organization, in another workspace only: the picker lists workspace members, so nobody matches.
  await searchTarget(dialog, s.outside.name);
  await expect(page.getByText("Không có thành viên nào khác nhận được tài liệu này.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("option", { name: who(s.outside.name) })).toHaveCount(0);

  // The leaver is a workspace member now, so the picker offers them.
  await pickTarget(page, dialog, leaver);

  // They leave the workspace after the pick; the dialog still holds them.
  const removed = await request.delete(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/members/${leaver.id}`, {
    headers: authHeaders(s.owner.token),
  });
  expect(removed.status(), await removed.text()).toBe(204);

  await confirmButton(dialog).click();
  await expect(
    dialog.getByRole("alert").filter({
      hasText: `${leaver.name} chưa là thành viên của workspace này nên không thể làm chủ sở hữu.`,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toBeVisible();

  // Nothing moved: the owner is still the ACL owner and the leaver holds nothing.
  const after = await sharesOf(request, s.owner.token, doc.id);
  expect(after.acl_owner?.user_id).toBe(s.owner.id);
  expect((after.shares ?? []).filter((r) => r.principal_id === leaver.id)).toHaveLength(0);
  expect(await levelOf(request, leaver.token, doc.id)).toBe("");
  expect(await levelOf(request, s.owner.token, doc.id)).not.toBe("");
});

test("DOC6-W01 a transfer back that keeps no access leaves the previous owner without a share", async ({
  browser,
  request,
}) => {
  const doc = await ownerDoc(request, s, "DOC6-none");

  // The first hop goes through the API: the owner hands the document to `other` and keeps Edit.
  const first = await putOwner(request, s.owner.token, doc.id, s.other.id, "edit");
  expect(first.status(), await first.text()).toBe(200);
  expect(await levelOf(request, s.other.token, doc.id)).toBe("manage");

  // The second hop is the new owner's, through the UI: back to the first owner, keeping nothing.
  const { context: otherContext, page: other } = await openSession(browser, s.other.email);
  try {
    const share = await openShareDialog(other, s.m.aOwner, doc.id);
    await expect(ownerRow(other, share)).toContainText(s.other.name);
    const dialog = await openTransfer(other, share);
    await pickTarget(other, dialog, s.owner);

    await dialog.getByRole("combobox", { name: `Quyền của ${s.other.name} sau khi chuyển` }).click();
    await other.getByRole("listbox").filter({ visible: true }).getByRole("option", { name: "Không giữ quyền" }).click();
    await expect(dialog.getByRole("combobox", { name: `Quyền của ${s.other.name} sau khi chuyển` })).toContainText(
      "Không giữ quyền",
    );
    await confirmButton(dialog).click();

    await toast(other, `Đã chuyển quyền sở hữu cho ${s.owner.name}`);
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  } finally {
    await otherContext.close();
  }

  const after = await sharesOf(request, s.owner.token, doc.id);
  expect(after.acl_owner?.user_id).toBe(s.owner.id);
  expect(
    (after.shares ?? []).filter((r) => r.principal_type === "user" && r.principal_id === s.other.id && r.active),
    "the previous owner kept no share",
  ).toHaveLength(0);
  expect(await levelOf(request, s.other.token, doc.id), "private document: the previous owner is out").toBe("");
  expect(await levelOf(request, s.owner.token, doc.id)).toBe("manage");
});
