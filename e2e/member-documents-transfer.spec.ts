import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { inviteAndAccept } from "./documents-fixtures";
import {
  api,
  authHeaders,
  buildShareScene,
  inboxOf,
  openSession,
  sharesOf,
  signInOwner,
  toast,
  who,
  type SharePerson,
  type ShareScene,
} from "./documents-share-fixtures";

/**
 * DOC-06b (UNI-2092, W-DOC06b e2e): moving a member's documents when they are
 * deactivated, on the real stack, no mocks. The member M owns documents in two
 * workspaces (W1, W2); the recipient R belongs to W1 only. The organization
 * owner deactivates M from Settings > Organization and picks R in the transfer
 * step: the W1 documents move, the W2 one is counted as skipped
 * (recipient_not_member). R hears ONE grouped notice. "Chuyển tài liệu" on M's
 * deactivated row then moves the rest to the owner (a member of every
 * workspace), and a third open says M owns nothing any more. Setup goes through
 * the API (the scene, M's workspace seats and documents); the transfer runs
 * through the UI; every claim about ownership is read back from the API.
 * Spec: docs/superpowers/specs/2026-10-15-documents-access-addendum.md §2.2,
 * §2.4, §4.2, row DOC6-W02.
 *
 * Needs the runtime of documents-share.spec.ts (FF_DOCUMENTS on, migrations of
 * this worktree applied, Team plan seeded by the fixture scene). Every row it
 * creates carries the run's unique tag, so nothing is deleted afterwards.
 */
test.describe.configure({ timeout: 360_000, mode: "serial" });

const tag = `mt2092-${Date.now().toString(36)}`;
const BULK_KIND = "document_owners_bulk_transferred";

let s: ShareScene;
/** The member whose documents move: a seat in W1 and in W2. */
let source: SharePerson;
/** The recipient of the first run: in W1 only. */
let recipient: SharePerson;
const w1Docs: string[] = [];
const w2Docs: string[] = [];

/** A page of `token`'s own in `wsId`, visible to the workspace so the owner can also take it over (no self_restricted skip). */
async function createDocAs(request: APIRequestContext, token: string, wsId: string, title: string): Promise<string> {
  const created = await request.post(`${api}/api/v1/workspaces/${wsId}/documents`, {
    headers: authHeaders(token),
    data: { kind: "page", title, visibility: "workspace" },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { document: { id: string } }).document.id;
}

/** The ACL owner of a document, as the organization owner (a manager of workspace-visible documents) reads it. */
async function aclOwnerOf(request: APIRequestContext, docId: string): Promise<string | undefined> {
  return (await sharesOf(request, s.owner.token, docId)).acl_owner?.user_id;
}

/** The grouped notices a person holds for the source member. */
async function bulkNotices(request: APIRequestContext, token: string) {
  return (await inboxOf(request, token)).filter((n) => n.kind === BULK_KIND && n.resource_id === source.id);
}

test.beforeAll(async ({ browser, request }) => {
  test.setTimeout(600_000);
  const page = await browser.newPage();
  try {
    s = await buildShareScene(page, tag, 1);
    source = s.extras[0]!;
    recipient = s.other;
    // The scene seats the extra in W1 only; M also joins W2, where R never is.
    await inviteAndAccept(page, api, s.owner.token, s.m.aWS2Id, source);
  } finally {
    await page.close();
  }
  for (const n of [1, 2]) {
    w1Docs.push(await createDocAs(request, source.token, s.m.aOwner.wsId, `DOC6b ${tag} W1-${n}`));
  }
  w2Docs.push(await createDocAs(request, source.token, s.m.aWS2Id, `DOC6b ${tag} W2-1`));
});

/** Settings > Organization > Members, with M's row in view. */
async function openMembers(page: Page): Promise<Locator> {
  await page.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/settings?tab=organization`);
  const row = page.getByRole("listitem").filter({ hasText: source.email });
  await expect(row).toBeVisible({ timeout: 60_000 });
  return row;
}

/** Types into the "Chuyển cho" picker and picks one person; the list is portalled out of the dialog. */
async function pickRecipient(page: Page, scope: Locator, person: SharePerson): Promise<void> {
  const combo = scope.getByRole("combobox", { name: "Chuyển cho" });
  await combo.click();
  await combo.fill(person.name);
  await page.getByRole("option", { name: who(person.name) }).first().click();
  await expect(combo).toHaveValue(person.name);
}

test("DOC6-W02 deactivating a member moves their documents where the recipient belongs, and counts the rest", async ({
  page,
  browser,
  request,
}) => {
  expect(await aclOwnerOf(request, w1Docs[0]!), "the member owns the W1 document").toBe(source.id);
  expect(await aclOwnerOf(request, w2Docs[0]!), "the member owns the W2 document").toBe(source.id);

  await signInOwner(page, s);
  const row = await openMembers(page);
  await row.getByRole("button", { name: "Vô hiệu hóa", exact: true }).click();

  const dialog = page.getByRole("alertdialog", { name: `Vô hiệu hóa ${source.name}?` });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  // The count step names the member's three documents and where they live.
  await expect(dialog.getByText(`${source.name} đang là chủ sở hữu của 3 tài liệu.`)).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText(`A Two ${tag}: 1`);
  await pickRecipient(page, dialog, recipient);
  await dialog.getByRole("button", { name: "Vô hiệu hóa", exact: true }).click();

  // The lock lands first, then the batches; the result says what moved and what did not, in words.
  await toast(page, "Đã vô hiệu hóa thành viên");
  await expect(dialog.getByRole("heading", { name: `${source.name} đã bị vô hiệu hóa` })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(`Đã chuyển 2 tài liệu cho ${recipient.name}.`)).toBeVisible({ timeout: 60_000 });
  await expect(
    dialog.getByText(`1 tài liệu ở workspace mà ${recipient.name} chưa tham gia chưa được chuyển.`),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Server truth: W1 documents belong to R, the W2 one is still M's.
  for (const id of w1Docs) {
    expect(await aclOwnerOf(request, id), "a W1 document moved to the recipient").toBe(recipient.id);
  }
  expect(await aclOwnerOf(request, w2Docs[0]!), "the W2 document stayed with the member").toBe(source.id);

  // R hears once for the whole run (two documents, one grouped notice), the caller never.
  await expect.poll(async () => (await bulkNotices(request, recipient.token)).length, { timeout: 60_000 }).toBe(1);
  const [notice] = await bulkNotices(request, recipient.token);
  expect(notice?.params.actor).toBe(s.owner.name);
  expect(notice?.params.name).toBe(source.name);
  expect(await bulkNotices(request, s.owner.token), "the caller never hears their own transfer").toHaveLength(0);

  const { context, page: inbox } = await openSession(browser, recipient.email);
  try {
    await inbox.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/inbox`);
    await expect(
      inbox.getByText(`${s.owner.name} đã chuyển cho bạn quyền sở hữu các tài liệu của ${source.name}.`).first(),
    ).toBeVisible({ timeout: 60_000 });
  } finally {
    await context.close();
  }
});

test("DOC6-W02 the row action moves the rest to the owner, and a third open finds nothing left", async ({
  page,
  request,
}) => {
  await signInOwner(page, s);
  let row = await openMembers(page);
  await expect(row.getByText("Đã vô hiệu hóa", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Chuyển tài liệu", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Chuyển tài liệu" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  // Only the W2 document is left; the owner is a member of every workspace, so they can take it.
  await expect(dialog.getByText(`${source.name} đang là chủ sở hữu của 1 tài liệu.`)).toBeVisible({ timeout: 30_000 });
  await pickRecipient(page, dialog, s.owner);
  await dialog.getByRole("button", { name: "Chuyển", exact: true }).click();
  await expect(dialog.getByText(`Đã chuyển 1 tài liệu cho ${s.owner.name}.`)).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  expect(await aclOwnerOf(request, w2Docs[0]!), "the W2 document moved to the owner").toBe(s.owner.id);

  // Nothing is left: the third open says so and offers no transfer.
  row = await openMembers(page);
  await row.getByRole("button", { name: "Chuyển tài liệu", exact: true }).click();
  const empty = page.getByRole("dialog", { name: "Chuyển tài liệu" });
  await expect(empty.getByText(`${source.name} không còn sở hữu tài liệu nào.`)).toBeVisible({ timeout: 30_000 });
  await expect(empty.getByRole("button", { name: "Chuyển", exact: true })).toHaveCount(0);

  // The owner took over their own run: no grouped notice for the caller.
  expect(await bulkNotices(request, s.owner.token)).toHaveLength(0);
});
