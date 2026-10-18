import { expect, test } from "@playwright/test";
import { contentRow } from "./documents-folders-fixtures";
import { newPageCard } from "./documents-onboard";
import {
  api,
  authHeaders,
  buildShareScene,
  candidatesOf,
  chipList,
  escapeRegExp,
  grantAccess,
  groupTargets,
  levelOf,
  libraryBadge,
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
 * SH-E2E (UNI-1788): the popup and batch rows (U-SH2, AC01–AC08) of the SRS
 * Share v1.0 addendum
 * (docs/superpowers/specs/2026-10-15-documents-share-srs-addendum.md §12) on
 * the real stack. UI flows run through the Share popup, the library row and
 * the inbox; server truth (all-or-nothing, on_existing, duplicates, Q-S1,
 * isolation) runs through PUT /access, GET /share-candidates and GET /shares.
 * Each test creates its own document, so the file runs in any order. The
 * other half of the rows is documents-share-rules.spec.ts.
 *
 * Needs the same runtime as documents-isolation.spec.ts (FF_DOCUMENTS on, the
 * worktree's migrations applied, Team plan seeded by the fixture scene).
 */
test.describe.configure({ timeout: 360_000 });

const tag = `sh1788-a-${Date.now().toString(36)}`;
const DOCUMENT_URL = /\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/;
// Ten organization members of A beside the matrix, for the batch rows (AC02, AC03).
const EXTRA_COUNT = 10;
const BATCH_PEOPLE = 10;

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

test("U-SH2 a new page is private; the create toggle shares it with the workspace at View (Q-S3)", async ({ page, request }) => {
  await signInOwner(page, s);
  const library = `/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/documents`;

  // Default: the toggle is off, and the page that comes out belongs to its owner alone.
  await page.goto(library);
  const toggle = page.getByRole("switch", { name: "Chia sẻ với workspace" });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(toggle).not.toBeChecked();
  await newPageCard(page).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });
  const privateId = page.url().split("/").pop()!;

  const doc = (await (await readDoc(request, s.owner.token, privateId)).json()) as { document: { visibility: string } };
  expect(doc.document.visibility).toBe("restricted");
  expect((await sharesOf(request, s.owner.token, privateId)).home_workspace?.level ?? null).toBeNull();
  expect(await levelOf(request, s.member.token, privateId)).toBe("");

  // Toggle on: the new page opens to the workspace at View, nothing more.
  await page.goto(library);
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByText("Mọi thành viên của workspace này sẽ chỉ xem tài liệu mới")).toBeVisible();
  await newPageCard(page).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });
  const sharedId = page.url().split("/").pop()!;
  expect(sharedId).not.toBe(privateId);

  expect((await sharesOf(request, s.owner.token, sharedId)).home_workspace?.level).toBe("view");
  expect(await levelOf(request, s.member.token, sharedId)).toBe("view");
  const write = await request.patch(`${api}/api/v1/documents/${sharedId}`, {
    headers: authHeaders(s.member.token),
    data: { revision: "1", title: "hijacked" },
  });
  expect(write.status(), "View never lets the workspace write").toBe(403);
});

test("AC01 one person at View: popup, confirmation toast, list row, and a dry run writes nothing", async ({ page, request }) => {
  const { id } = await ownerDoc(request, s, "AC01");

  // dry_run reports what would happen and leaves no row behind (spec §6.1).
  const dry = await putAccess(request, s.owner.token, id, [userItem(s.member, "view")], true);
  expect(dry.status(), await dry.text()).toBe(200);
  const dryBody = (await dry.json()) as { dry_run: boolean; results: { status: string }[] };
  expect(dryBody.dry_run).toBe(true);
  expect(dryBody.results[0]?.status).toBe("granted");
  expect((await sharesOf(request, s.owner.token, id)).shares ?? []).toHaveLength(0);
  expect(await levelOf(request, s.member.token, id)).toBe("");

  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);
  await pickCandidate(dialog, s.member.name, who(s.member.name));
  await expect(chipList(dialog).getByText(who(s.member.name))).toBeVisible();
  await expect(dialog.getByText("Đã chọn 1", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Mức quyền", exact: true })).toHaveText(/Chỉ xem/);
  await submitShare(dialog).click();

  await toast(page, "Đã chia sẻ cho 1 đối tượng");
  await expect(chipList(dialog)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: `Thu hồi ${s.member.name}`, exact: true })).toBeVisible({ timeout: 30_000 });

  expect(await levelOf(request, s.member.token, id)).toBe("view");
  const write = await request.patch(`${api}/api/v1/documents/${id}`, {
    headers: authHeaders(s.member.token),
    data: { revision: "1", title: "hijacked" },
  });
  expect(write.status()).toBe(403);
  expect(await levelOf(request, s.other.token, id)).toBe("");
});

test("AC02 ten people at View in one batch", async ({ request }) => {
  const { id } = await ownerDoc(request, s, "AC02");
  const people = s.extras.slice(0, BATCH_PEOPLE);
  const result = await grantAccess(request, s.owner.token, id, people.map((p) => userItem(p, "view")));
  expect(result.results).toHaveLength(BATCH_PEOPLE);
  expect(result.results.every((r) => r.status === "granted")).toBe(true);
  for (const p of people) expect(await levelOf(request, p.token, id), p.name).toBe("view");
  expect(await levelOf(request, s.other.token, id), "someone outside the batch stays out").toBe("");

  const rows = (await sharesOf(request, s.owner.token, id)).shares ?? [];
  expect(rows.filter((r) => r.principal_type === "user")).toHaveLength(BATCH_PEOPLE);
  const picked = (await candidatesOf(request, s.owner.token, id, people[0]!.name)).find((c) => c.principal_id === people[0]!.id);
  expect(picked?.direct_level, "the picker marks who already holds a grant (FR-02)").toBe("view");
});

test("AC03 three people at Edit and seven at View: per-person levels with a live summary", async ({ page, request }) => {
  // Server truth: one batch, ten rows, two levels.
  const batch = await ownerDoc(request, s, "AC03");
  const people = s.extras.slice(0, BATCH_PEOPLE);
  await grantAccess(
    request,
    s.owner.token,
    batch.id,
    people.map((p, i) => userItem(p, i < 3 ? "edit" : "view")),
  );
  for (const [i, p] of people.entries()) expect(await levelOf(request, p.token, batch.id), p.name).toBe(i < 3 ? "edit" : "view");

  // The popup: three chips, one raised to Edit, the summary follows, the common level keeps their own.
  const { id } = await ownerDoc(request, s, "AC03-ui");
  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);
  const chosen = [s.member, s.other, s.extras[0]!];
  for (const p of chosen) await pickCandidate(dialog, p.name, who(p.name));
  await expect(dialog.getByText("Đã chọn 3", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Thiết lập quyền riêng" }).click();
  const summary = dialog.getByRole("status").filter({ hasText: /Chỉ xem|Chỉnh sửa/ });
  await expect(summary).toHaveText("3 Chỉ xem");
  await dialog.getByRole("combobox", { name: `Mức quyền của ${s.other.name}` }).click();
  await page.getByRole("listbox").filter({ visible: true }).getByRole("option", { name: "Chỉnh sửa" }).click();
  await expect(summary).toHaveText("2 Chỉ xem · 1 Chỉnh sửa");

  // Changing the common level never overwrites a level set per person without asking.
  // The per-person popup must be gone first: a click that lands while it closes opens nothing.
  const openList = page.getByRole("listbox").filter({ visible: true });
  await expect(openList).toHaveCount(0);
  await dialog.getByRole("combobox", { name: "Mức quyền", exact: true }).click();
  await expect(openList.getByRole("option", { name: "Nhận xét" })).toBeVisible();
  await openList.getByRole("option", { name: "Nhận xét" }).click();
  await expect(dialog.getByText("Đặt tất cả 3 đối tượng thành Nhận xét?")).toBeVisible();
  await dialog.getByRole("button", { name: /^Hu/ }).click();
  await expect(summary).toHaveText("2 Chỉ xem · 1 Chỉnh sửa");

  await submitShare(dialog).click();
  await toast(page, "Đã chia sẻ cho 3 đối tượng");
  expect(await levelOf(request, s.member.token, id)).toBe("view");
  expect(await levelOf(request, s.other.token, id)).toBe("edit");
  expect(await levelOf(request, s.extras[0]!.token, id)).toBe("view");
});

test("AC04 the workspace at View goes through the home row, not a share row", async ({ page, request }) => {
  const { id, title } = await ownerDoc(request, s, "AC04");
  const { homeName } = await groupTargets(request, s.owner.token, id);
  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);
  await expect(dialog.getByText(/^Lưu tại: Workspace /)).toBeVisible();

  await pickCandidate(dialog, homeName, who(homeName));
  await expect(chipList(dialog).getByText(who(homeName))).toBeVisible();
  await submitShare(dialog).click();
  await toast(page, "Đã chia sẻ cho 1 đối tượng");
  const row = dialog.getByRole("region", { name: "Người và nhóm có quyền" }).getByRole("listitem").filter({ hasText: "Nơi lưu" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText(`Workspace ${homeName}`);

  const access = await sharesOf(request, s.owner.token, id);
  expect(access.home_workspace?.level).toBe("view");
  expect((access.shares ?? []).filter((r) => r.principal_type === "workspace"), "no document_shares row for the home workspace").toHaveLength(0);
  expect(await levelOf(request, s.member.token, id)).toBe("view");
  expect(await levelOf(request, s.other.token, id)).toBe("view");
  expect(await levelOf(request, s.outside.token, id), "a member of the other workspace stays out").toBe("");

  await page.keyboard.press("Escape");
  await page.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/documents`);
  await expect(libraryBadge(contentRow(page, title))).toHaveAttribute("data-scope-kind", "workspace", { timeout: 60_000 });
});

test("AC05 + Q-S1 the organization at Edit asks to confirm; Manage is refused for the organization and the home row", async ({ page, request }) => {
  const { id } = await ownerDoc(request, s, "AC05");
  const { orgId, orgName, homeId } = await groupTargets(request, s.owner.token, id);
  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);

  await pickCandidate(dialog, orgName, who(orgName));
  await dialog.getByRole("combobox", { name: "Mức quyền", exact: true }).click();
  await page.getByRole("listbox").filter({ visible: true }).getByRole("option", { name: "Chỉnh sửa" }).click();
  await submitShare(dialog).click();

  // A wide grant reads back what it reaches before anything is written.
  const confirm = dialog.getByTestId("share-add-confirm");
  await expect(confirm).toContainText(/Chia sẻ cho toàn bộ Tổ chức .* \(\d+ thành viên\) ở mức Chỉnh sửa/, { timeout: 30_000 });
  expect((await sharesOf(request, s.owner.token, id)).shares ?? []).toHaveLength(0);
  await confirm.getByRole("button", { name: /^Hu/ }).click();
  await expect(confirm).toHaveCount(0);
  expect((await sharesOf(request, s.owner.token, id)).shares ?? []).toHaveLength(0);

  await submitShare(dialog).click();
  await dialog.getByTestId("share-add-confirm").getByRole("button", { name: "Xác nhận" }).click();
  await toast(page, "Đã chia sẻ cho 1 đối tượng");
  const org = ((await sharesOf(request, s.owner.token, id)).shares ?? []).find((r) => r.principal_type === "organization");
  expect(org?.level).toBe("edit");
  for (const p of [s.member, s.outside, s.extras[0]!]) expect(await levelOf(request, p.token, id), p.name).toBe("edit");

  // Q-S1: Manage is not available to the whole organization or to the home workspace.
  const fresh = await ownerDoc(request, s, "AC05-qs1");
  const orgManage = await putAccess(request, s.owner.token, fresh.id, [{ principal_type: "organization", principal_id: orgId, level: "manage" }]);
  expect(orgManage.status()).toBe(422);
  const orgBody = await rejectedOf(orgManage);
  expect(orgBody.code).toBe("document_access_rejected");
  expect(orgBody.rejected[0]).toMatchObject({ index: 0, principal_type: "organization", code: "level_not_allowed" });

  const homeManage = await rejectedOf(
    await putAccess(request, s.owner.token, fresh.id, [{ principal_type: "workspace", principal_id: homeId, level: "manage" }]),
  );
  expect(homeManage.rejected[0]?.code).toBe("level_not_allowed");

  const single = await request.post(`${api}/api/v1/documents/${fresh.id}/shares`, {
    headers: authHeaders(s.owner.token),
    data: { principal_type: "organization", principal_id: orgId, level: "manage" },
  });
  expect(single.status()).toBe(422);
  expect(((await single.json()) as { error: { code: string } }).error.code).toBe("level_not_allowed");
  expect((await sharesOf(request, s.owner.token, fresh.id)).shares ?? [], "a refused batch writes nothing (U-SH3)").toHaveLength(0);

  // Another workspace may hold Manage, with the wide-scope warning.
  const dry = await putAccess(request, s.owner.token, fresh.id, [{ principal_type: "workspace", principal_id: s.m.aWS2Id, level: "manage" }], true);
  expect(dry.status(), await dry.text()).toBe(200);
  const preview = (await dry.json()) as { preview: { warnings: { code: string }[] } };
  expect(preview.preview.warnings.map((w) => w.code)).toContain("wide_scope");
});

test("AC06 + AC12 Organization at Edit with a Person at View: the person keeps Edit and the popup says why", async ({ page, request }) => {
  const { id } = await ownerDoc(request, s, "AC06");
  const { orgId, homeId, orgName } = await groupTargets(request, s.owner.token, id);
  await grantAccess(request, s.owner.token, id, [
    { principal_type: "organization", principal_id: orgId, level: "edit" },
    { principal_type: "workspace", principal_id: homeId, level: "view" },
  ]);

  // Granting the person a lower level than the group warns before writing.
  const dry = await putAccess(request, s.owner.token, id, [userItem(s.member, "view")], true);
  const preview = (await dry.json()) as {
    preview: { users: { user_id: string; after: { level: string } }[]; warnings: { code: string }[] };
  };
  expect(preview.preview.warnings.map((w) => w.code)).toContain("direct_below_group");
  expect(preview.preview.users.find((u) => u.user_id === s.member.id)?.after.level).toBe("edit");
  await grantAccess(request, s.owner.token, id, [userItem(s.member, "view")]);

  const row = (await sharesOf(request, s.owner.token, id)).shares?.find((r) => r.principal_id === s.member.id);
  expect(row).toMatchObject({ level: "view", effective_level: "edit" });
  expect(row?.warnings).toContain("direct_below_group");
  expect((row?.sources ?? []).length, "every source, not only the narrowest").toBeGreaterThanOrEqual(2);
  expect(await levelOf(request, s.member.token, id)).toBe("edit");

  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);
  const list = dialog.getByRole("region", { name: "Người và nhóm có quyền" });
  const personRow = list.getByRole("listitem").filter({ hasText: who(s.member.name) });
  await expect(personRow.getByText(/Quyền thực tế: Chỉnh sửa/)).toBeVisible({ timeout: 30_000 });
  await expect(personRow.getByTestId(`warning-direct-below-group-${s.member.id}`)).toContainText("vẫn có quyền Chỉnh sửa qua");
  await personRow.getByRole("button", { name: /^Nguồn quyền \([2-9]\)/ }).click();
  await expect(personRow.getByText(new RegExp(`Chỉnh sửa qua Tổ chức ${escapeRegExp(orgName)}`))).toBeVisible();
  await expect(personRow.getByText(/Chỉ xem qua chia sẻ trực tiếp/)).toBeVisible();
});

test("AC07 revoking a Person at Edit while the Workspace stays at View: the preview sentence, then the toast", async ({ page, request }) => {
  const { id } = await ownerDoc(request, s, "AC07");
  const { homeId } = await groupTargets(request, s.owner.token, id);
  await grantAccess(request, s.owner.token, id, [
    { principal_type: "workspace", principal_id: homeId, level: "view" },
    userItem(s.member, "edit"),
  ]);
  expect(await levelOf(request, s.member.token, id)).toBe("edit");

  // The dry run answers with the standing after the revoke and writes nothing.
  const dry = await putAccess(request, s.owner.token, id, [userItem(s.member, null)], true);
  const after = ((await dry.json()) as { preview: { users: { before: { level: string }; after: { level: string } }[] } }).preview.users[0];
  expect(after).toMatchObject({ before: { level: "edit" }, after: { level: "view" } });
  expect(await levelOf(request, s.member.token, id)).toBe("edit");

  await signInOwner(page, s);
  const dialog = await openShareDialog(page, s.m.aOwner, id);
  await dialog.getByRole("button", { name: `Thu hồi ${s.member.name}`, exact: true }).click();
  const confirm = dialog.getByTestId("share-access-confirm");
  await expect(confirm).toContainText(`${s.member.name} vẫn có quyền Chỉ xem qua Workspace`, { timeout: 30_000 });
  await confirm.getByRole("button", { name: "Xác nhận" }).click();
  await toast(
    page,
    new RegExp(`Đã thu hồi quyền chia sẻ trực tiếp của ${escapeRegExp(s.member.name)}\\. ${escapeRegExp(s.member.name)} vẫn có quyền Chỉ xem qua Workspace`),
  );
  await expect(dialog.getByRole("button", { name: `Thu hồi ${s.member.name}`, exact: true })).toHaveCount(0, { timeout: 30_000 });

  expect(await levelOf(request, s.member.token, id), "the workspace row still gives View").toBe("view");
  expect(((await sharesOf(request, s.owner.token, id)).shares ?? []).some((r) => r.principal_id === s.member.id)).toBe(false);
});

test("AC08 revoking every source leaves the document private; an admin keeps admin scope only", async ({ page, request }) => {
  const { id, title } = await ownerDoc(request, s, "AC08");
  const { orgId, homeId } = await groupTargets(request, s.owner.token, id);
  await grantAccess(request, s.owner.token, id, [
    { principal_type: "workspace", principal_id: homeId, level: "view" },
    { principal_type: "organization", principal_id: orgId, level: "edit" },
    userItem(s.member, "comment"),
  ]);
  expect(await levelOf(request, s.member.token, id)).toBe("edit");

  const revoked = await grantAccess(request, s.owner.token, id, [
    { principal_type: "workspace", principal_id: homeId, level: null },
    { principal_type: "organization", principal_id: orgId, level: null },
    userItem(s.member, null),
  ]);
  expect(revoked.results.map((r) => r.status)).toEqual(["revoked", "revoked", "revoked"]);
  const access = await sharesOf(request, s.owner.token, id);
  expect(access.shares ?? []).toHaveLength(0);
  expect(access.home_workspace?.level ?? null).toBeNull();
  for (const p of [s.member, s.other, s.outside]) expect(await levelOf(request, p.token, id), p.name).toBe("");

  // The workspace admin manages without reading (DOC-05): admin scope, no level.
  const asAdmin = await sharesOf(request, s.admin.token, id);
  expect(asAdmin.admin_scope).toBe(true);
  expect(asAdmin.my_level).toBe("");

  await signInOwner(page, s);
  await page.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/documents`);
  const badge = libraryBadge(contentRow(page, title));
  await expect(badge).toHaveAttribute("data-scope-kind", "private", { timeout: 60_000 });
  await expect(badge).toContainText("Riêng tư");
});
