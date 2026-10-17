import { expect, test } from "@playwright/test";
import { deactivateOrgMember } from "./documents-fixtures";
import { contentRow } from "./documents-folders-fixtures";
import {
  api,
  authHeaders,
  buildShareScene,
  candidatesOf,
  docPath,
  escapeRegExp,
  grantAccess,
  groupTargets,
  inboxOf,
  levelOf,
  libraryBadge,
  openSession,
  openShareDialog,
  ownerDoc,
  pickCandidate,
  putAccess,
  readDoc,
  rejectedOf,
  sharesOf,
  signInOwner,
  submitShare,
  toast,
  userItem,
  who,
  type ShareScene,
} from "./documents-share-fixtures";

/**
 * SH-E2E (UNI-1788): the access rules, library scope, inbox and isolation rows
 * (AC09–AC20, U-SH3, U-SH4, FR-13) of the SRS Share v1.0 addendum
 * (docs/superpowers/specs/2026-10-15-documents-share-srs-addendum.md §12) on
 * the real stack. UI flows run through the Share popup, the library row and
 * the inbox; server truth (all-or-nothing, on_existing, duplicates, Q-S1,
 * isolation) runs through PUT /access, GET /share-candidates and GET /shares.
 * Each test creates its own document, so the file runs in any order. The
 * other half of the rows is documents-share.spec.ts.
 *
 * Needs the same runtime as documents-isolation.spec.ts (FF_DOCUMENTS on, the
 * worktree's migrations applied, Team plan seeded by the fixture scene).
 */
test.describe.configure({ timeout: 360_000 });

const tag = `sh1788-b-${Date.now().toString(36)}`;
// Organization members of A beside the matrix: three plain recipients, one who
// leaves the workspace (AC16) and one who is deactivated mid-selection (U-SH3).
const EXTRA_COUNT = 5;
const LEAVER = 3;
const DEACTIVATED = 4;

let s: ShareScene;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await browser.newPage();
  try {
    s = await buildShareScene(page, tag, EXTRA_COUNT);
  } finally {
    await page.close();
  }
});

test("AC09 without Manage there is no way to change access, list candidates or see others", async ({ request }) => {
  const { id } = await ownerDoc(request, s, "AC09");
  await grantAccess(request, s.owner.token, id, [userItem(s.member, "edit"), userItem(s.extras[0]!, "view")]);

  const put = await putAccess(request, s.member.token, id, [userItem(s.other, "view")]);
  expect(put.status(), "an editor cannot administer").toBe(403);
  const candidates = await request.get(`${api}/api/v1/documents/${id}/share-candidates?q=`, { headers: authHeaders(s.member.token) });
  expect(candidates.status()).toBe(403);
  expect(await levelOf(request, s.other.token, id)).toBe("");

  // U-SH4: the caller reads only their own level and sources, never the list of others.
  const mine = await sharesOf(request, s.member.token, id);
  expect(mine.my_level).toBe("edit");
  expect(mine.my_sources.length).toBeGreaterThanOrEqual(1);
  expect(mine.shares ?? []).toHaveLength(0);
  expect(mine.home_workspace).toBeUndefined();
  expect(mine.acl_owner).toBeUndefined();

  // A person with no access at all gets the same answer as for an unknown id.
  const hidden = await putAccess(request, s.other.token, id, [userItem(s.other, "view")]);
  expect(hidden.status()).toBe(404);
});

test("U-SH4 a person without Manage opens Share and sees their own level and sources only", async ({ browser, request }) => {
  const { id } = await ownerDoc(request, s, "U-SH4");
  const { homeId } = await groupTargets(request, s.owner.token, id);
  await grantAccess(request, s.owner.token, id, [
    { principal_type: "workspace", principal_id: homeId, level: "view" },
    userItem(s.member, "edit"),
  ]);
  const { context, page } = await openSession(browser, s.member.email);
  try {
    await page.goto(docPath(s.m.aOwner, id));
    await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Hành động khác|More actions/ }).click();
    await page.getByRole("menuitem", { name: "Chia sẻ" }).click();
    const dialog = page.getByRole("dialog", { name: /^Chia sẻ “/ });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText("Quyền của bạn: Chỉnh sửa")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText(/Chỉnh sửa qua chia sẻ trực tiếp/)).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Thêm quyền" })).toHaveCount(0);
    await expect(dialog.getByRole("combobox", { name: "Chọn đối tượng" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Tạo liên kết mới" })).toHaveCount(0);
    await expect(dialog.getByText(s.extras[0]!.name)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("AC11 sharing to another workspace does not move the document", async ({ request }) => {
  const { id } = await ownerDoc(request, s, "AC11");
  expect(await levelOf(request, s.outside.token, id)).toBe("");
  const dry = await putAccess(request, s.owner.token, id, [{ principal_type: "workspace", principal_id: s.m.aWS2Id, level: "edit" }], true);
  const group = ((await dry.json()) as { preview: { groups: { member_count: number }[] } }).preview.groups[0];
  expect(group?.member_count, "the group is counted, not named").toBeGreaterThanOrEqual(1);
  await grantAccess(request, s.owner.token, id, [{ principal_type: "workspace", principal_id: s.m.aWS2Id, level: "edit" }]);

  const doc = (await (await readDoc(request, s.owner.token, id)).json()) as { document: { workspace_id: string } };
  expect(doc.document.workspace_id, "the home workspace is unchanged").toBe(s.m.aOwner.wsId);
  expect(await levelOf(request, s.outside.token, id)).toBe("edit");

  const inWs2 = await request.get(`${api}/api/v1/workspaces/${s.m.aWS2Id}/documents`, { headers: authHeaders(s.outside.token) });
  expect(inWs2.status()).toBe(200);
  expect(await inWs2.text(), "it does not become a document of the other workspace").not.toContain(id);
  const shared = await request.get(`${api}/api/v1/workspaces/${s.m.aWS2Id}/documents/shared-with-me`, { headers: authHeaders(s.outside.token) });
  expect(shared.status()).toBe(200);
  expect(await shared.text()).toContain(id);
});

test("AC13 a second grant to the same person: keep or update, duplicates refused, one row", async ({ page, request }) => {
  const { id } = await ownerDoc(request, s, "AC13");
  await grantAccess(request, s.owner.token, id, [userItem(s.member, "view")]);

  const kept = await grantAccess(request, s.owner.token, id, [userItem(s.member, "edit", "keep")]);
  expect(kept.results[0]?.status).toBe("kept");
  expect(await levelOf(request, s.member.token, id)).toBe("view");

  const duplicate = await rejectedOf(await putAccess(request, s.owner.token, id, [userItem(s.member, "view"), userItem(s.member, "comment")]));
  expect(duplicate.code).toBe("document_access_rejected");
  expect(duplicate.rejected.map((r) => r.code)).toContain("duplicate_principal");
  expect(await levelOf(request, s.member.token, id)).toBe("view");

  // The picker marks the person and offers Keep (default) or Update.
  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);
  const combo = dialog.getByRole("combobox", { name: "Chọn đối tượng" });
  await combo.click();
  await combo.fill(s.member.name);
  const option = dialog.getByRole("option", { name: who(s.member.name) }).first();
  await expect(option).toContainText("Đã có quyền: Chỉ xem");
  await option.click();
  await dialog.getByRole("combobox", { name: "Mức quyền", exact: true }).click();
  await page.getByRole("option", { name: "Chỉnh sửa" }).click();
  const choice = dialog.getByRole("combobox", { name: new RegExp(`^${escapeRegExp(s.member.name)} Đã có quyền`) });
  await expect(choice).toContainText("Giữ Chỉ xem");
  await choice.click();
  await page.getByRole("option", { name: "Cập nhật thành Chỉnh sửa" }).click();
  await submitShare(dialog).click();
  await toast(page, "Đã chia sẻ cho 1 đối tượng");

  await expect.poll(() => levelOf(request, s.member.token, id), { timeout: 30_000 }).toBe("edit");
  const rows = ((await sharesOf(request, s.owner.token, id)).shares ?? []).filter((r) => r.principal_id === s.member.id);
  expect(rows, "still one live row for the person").toHaveLength(1);
});

test("AC16 leaving the workspace ends the access that came through it", async ({ request }) => {
  const { id } = await ownerDoc(request, s, "AC16");
  const leaver = s.extras[LEAVER]!;
  const { homeId } = await groupTargets(request, s.owner.token, id);
  await grantAccess(request, s.owner.token, id, [{ principal_type: "workspace", principal_id: homeId, level: "view" }]);
  expect(await levelOf(request, leaver.token, id)).toBe("view");

  const removed = await request.delete(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/members/${leaver.id}`, {
    headers: authHeaders(s.owner.token),
  });
  expect(removed.status(), await removed.text()).toBe(204);
  expect(await levelOf(request, leaver.token, id), "membership is read live, not copied at share time").toBe("");
  expect(await levelOf(request, s.member.token, id)).toBe("view");
});

test("AC19 the library row shows the share scope as a type and a count, never names", async ({ page, request }) => {
  const { id, title } = await ownerDoc(request, s, "AC19");
  const { homeId, homeName } = await groupTargets(request, s.owner.token, id);
  await signInOwner(page, s);
  const library = `/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/documents`;
  const badge = async (kind: string, text: RegExp) => {
    await page.goto(library);
    const mark = libraryBadge(contentRow(page, title));
    await expect(mark).toHaveAttribute("data-scope-kind", kind, { timeout: 60_000 });
    await expect(mark).toContainText(text);
    return mark;
  };

  await badge("private", /Riêng tư/);
  await grantAccess(request, s.owner.token, id, [userItem(s.extras[0]!, "view"), userItem(s.extras[1]!, "view")]);
  await badge("people", /2 người/);

  await grantAccess(request, s.owner.token, id, [{ principal_type: "workspace", principal_id: homeId, level: "view" }]);
  const multiple = await badge("multiple", /Nhiều phạm vi/);
  await expect(multiple).toHaveAttribute("title", new RegExp(`Workspace ${escapeRegExp(homeName)} · 2 người`));

  // A reader of the row gets the counts and no names (U-SH4).
  const listed = await request.get(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/documents`, { headers: authHeaders(s.member.token) });
  const row = ((await listed.json()) as { documents: { id: string; share_scope?: Record<string, unknown> }[] }).documents.find((d) => d.id === id);
  expect(row?.share_scope).toMatchObject({ home_workspace: true, users: 2, workspaces: 0, organization: false });
  const text = JSON.stringify(row);
  expect(text).not.toContain(s.extras[0]!.email);
  expect(text).not.toContain(s.extras[0]!.name);
});

test("AC20 opening a document's URL grants nothing; Stored-in is separate from sharing", async ({ browser, page, request }) => {
  const { id } = await ownerDoc(request, s, "AC20");
  const { homeName } = await groupTargets(request, s.owner.token, id);

  const { context, page: visitor } = await openSession(browser, s.other.email);
  try {
    await visitor.goto(docPath(s.m.aOwner, id));
    await expect(visitor.getByRole("heading", { name: "Bạn chưa mở được tài liệu này" })).toBeVisible({ timeout: 60_000 });
    await expect(visitor.getByRole("textbox", { name: "Nội dung tài liệu" })).toHaveCount(0);
  } finally {
    await context.close();
  }
  const access = await sharesOf(request, s.owner.token, id);
  expect(access.shares ?? [], "opening the URL created no share").toHaveLength(0);
  expect(access.home_workspace?.level ?? null).toBeNull();
  expect(await levelOf(request, s.other.token, id)).toBe("");

  // The dialog says where the document is stored without turning that into access.
  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);
  await expect(dialog.getByText(`Lưu tại: Workspace ${homeName}`)).toBeVisible();
  await expect(dialog.getByText("Chủ sở hữu", { exact: true })).toBeVisible();
  expect(await levelOf(request, s.other.token, id)).toBe("");
});

test("U-SH3 one bad recipient rejects the whole batch; the popup marks that chip only", async ({ page, request }) => {
  const { id } = await ownerDoc(request, s, "U-SH3");

  // API: another organization's user in the batch -> 422, nothing written, no name in the answer.
  const refused = await putAccess(request, s.owner.token, id, [userItem(s.member, "view"), userItem(s.foreign, "view")]);
  expect(refused.status()).toBe(422);
  const body = await rejectedOf(refused);
  expect(body.code).toBe("document_access_rejected");
  expect(body.rejected).toHaveLength(1);
  expect(body.rejected[0]).toMatchObject({ index: 1, principal_id: s.foreign.id, code: "principal_not_in_organization" });
  expect(body.text).not.toContain(s.foreign.name);
  expect(body.text).not.toContain(s.foreign.email);
  expect((await sharesOf(request, s.owner.token, id)).shares ?? []).toHaveLength(0);
  expect(await levelOf(request, s.member.token, id)).toBe("");
  const probe = await candidatesOf(request, s.owner.token, id, s.foreign.name);
  expect(probe.some((c) => c.principal_id === s.foreign.id), "another organization's person is never a candidate").toBe(false);

  // UI: the person is deactivated after being picked; the batch is refused as a whole.
  const leaving = s.extras[DEACTIVATED]!;
  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);
  await pickCandidate(dialog, s.member.name, who(s.member.name));
  await pickCandidate(dialog, leaving.name, who(leaving.name));
  await expect(dialog.getByText("Đã chọn 2", { exact: true })).toBeVisible();
  await deactivateOrgMember(leaving.email);
  await submitShare(dialog).click();

  await expect(dialog.getByTestId(`rejected-reason-${leaving.id}`)).toHaveText("Không thuộc tổ chức này", { timeout: 30_000 });
  await expect(dialog.getByTestId(`rejected-reason-${s.member.id}`)).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toContainText(`${leaving.name}: Không thuộc tổ chức này`);
  await expect(page.getByText(/Đã chia sẻ cho/)).toHaveCount(0);
  expect(await levelOf(request, s.member.token, id), "the valid recipient is not saved either").toBe("");

  // Dropping the bad chip lets the rest through.
  await dialog.getByRole("button", { name: `Bỏ chọn ${leaving.name}`, exact: true }).click();
  await submitShare(dialog).click();
  await toast(page, "Đã chia sẻ cho 1 đối tượng");
  expect(await levelOf(request, s.member.token, id)).toBe("view");
});

test("isolation another organization reaches neither the access nor the candidates route", async ({ request }) => {
  const { id } = await ownerDoc(request, s, "ISO");
  const put = await putAccess(request, s.m.bOwner.token, id, [userItem(s.foreign, "view")]);
  expect(put.status()).toBe(404);
  const candidates = await request.get(`${api}/api/v1/documents/${id}/share-candidates?q=`, { headers: authHeaders(s.m.bOwner.token) });
  expect(candidates.status()).toBe(404);
  const unknown = await request.get(`${api}/api/v1/documents/01JZZZZZZZZZZZZZZZZZZZZZZZ/share-candidates?q=`, {
    headers: authHeaders(s.m.bOwner.token),
  });
  expect(await candidates.text(), "the same answer as for an id nobody holds").toBe(await unknown.text());
  expect((await sharesOf(request, s.owner.token, id)).shares ?? []).toHaveLength(0);
});

test("FR-13 the recipient gets a document_shared inbox item with the level; groups and lowering stay silent", async ({ browser, request }) => {
  const { id, title } = await ownerDoc(request, s, "FR13");
  const control = s.extras[2]!;
  const sharedKind = async (token: string, docId: string) =>
    (await inboxOf(request, token)).filter((n) => n.kind === "document_shared" && n.resource_id === docId);

  await grantAccess(request, s.owner.token, id, [userItem(s.member, "edit")]);
  await expect.poll(async () => (await sharedKind(s.member.token, id)).length, { timeout: 30_000 }).toBe(1);

  const { context, page } = await openSession(browser, s.member.email);
  try {
    await page.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/inbox`);
    const item = page.getByRole("link", {
      name: new RegExp(`${escapeRegExp(s.owner.name)} đã chia sẻ tài liệu “${escapeRegExp(title)}” với bạn\\. Quyền: Chỉnh sửa`),
    });
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.click();
    await expect(page).toHaveURL(new RegExp(`${id}$`), { timeout: 30_000 });
    await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  } finally {
    await context.close();
  }

  // Lowering and revoking tell nobody (Q-S2); a group share never notifies a member (FR-13 rule 2).
  const { homeId } = await groupTargets(request, s.owner.token, id);
  await grantAccess(request, s.owner.token, id, [userItem(s.member, "view")]);
  await grantAccess(request, s.owner.token, id, [userItem(s.member, null), { principal_type: "workspace", principal_id: homeId, level: "view" }]);
  // The control person is notified last, so once it arrives the outbox has passed everything above.
  await grantAccess(request, s.owner.token, id, [userItem(control, "view")]);
  await expect.poll(async () => (await sharedKind(control.token, id)).length, { timeout: 30_000 }).toBe(1);
  expect(await sharedKind(s.member.token, id), "no second item for the member").toHaveLength(1);
  expect(await sharedKind(s.other.token, id), "a workspace member is not told about a workspace share").toHaveLength(0);
});
