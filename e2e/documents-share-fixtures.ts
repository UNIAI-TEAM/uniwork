import { expect, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { documentMatrix, inviteAndAccept, type DocsUser, type DocumentMatrix } from "./documents-fixtures";
import { registerFolderUser } from "./documents-folders-fixtures";
import { documentAction } from "./documents-onboard";
import { VI_LOCALE_STATE } from "./locale-state";
import { loginViaUi } from "./meeting-recording-fixture";

/**
 * Fixtures of the SH-E2E spec (UNI-1788, e2e/documents-share.spec.ts): the
 * G1-09 scene of documents-fixtures.ts plus a few more organization members,
 * thin wrappers over the sharing routes of the SRS addendum §6
 * (PUT /access, GET /share-candidates, GET /shares) and the popup helpers.
 * Nothing here asserts an acceptance criterion; the spec does.
 */
export const api = e2eApiUrl;

export interface SharePerson extends DocsUser {
  id: string;
  /** The display name: registration uses the tag as the display name. */
  name: string;
}

export interface ShareScene {
  m: DocumentMatrix;
  owner: SharePerson;
  member: SharePerson;
  other: SharePerson;
  admin: SharePerson;
  outside: SharePerson;
  foreign: SharePerson;
  /** Organization members of A with no access anywhere, one per extra name. */
  extras: SharePerson[];
}

export interface AccessItem {
  principal_type: "user" | "workspace" | "organization";
  principal_id: string;
  level: "view" | "comment" | "edit" | "manage" | null;
  on_existing?: "update" | "keep";
}

export interface AccessSource {
  via: string;
  principal_type?: string;
  principal_id?: string;
  level: string;
}

export interface ShareRow {
  id: string;
  principal_type: string;
  principal_id: string;
  level: string;
  active: boolean;
  effective_level?: string;
  sources?: AccessSource[];
  warnings?: string[];
}

export interface AccessBody {
  my_level: string;
  via: string;
  my_sources: AccessSource[];
  admin_scope?: boolean;
  acl_owner?: { user_id: string; level: string };
  home_workspace?: { workspace_id: string; workspace_name: string; visibility: string; level: string | null };
  shares?: ShareRow[];
  links?: unknown[];
}

export interface AccessResult {
  batch_id: string;
  dry_run: boolean;
  results: { index: number; principal_id: string; status: string; level: string | null; previous_level: string | null }[];
  preview: {
    users: { user_id: string; before: { level: string; via: string }; after: { level: string; via: string } }[];
    groups: { principal_type: string; principal_id: string; name: string; member_count: number; losing_count: number }[];
    warnings: { code: string; index: number }[];
  };
}

export interface RejectedItem {
  index: number;
  principal_type: string;
  principal_id: string;
  code: string;
}

export interface Candidate {
  principal_type: string;
  principal_id: string;
  name: string;
  secondary?: string;
  direct_level: string | null;
  is_home_workspace: boolean;
}

export interface NotificationRow {
  id: string;
  kind: string;
  resource_id: string;
  params: Record<string, string>;
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function userIdOf(request: APIRequestContext, token: string): Promise<string> {
  const me = await request.get(`${api}/api/v1/me`, { headers: authHeaders(token) });
  expect(me.status(), await me.text()).toBe(200);
  return ((await me.json()) as { user: { id: string } }).user.id;
}

async function person(request: APIRequestContext, user: DocsUser, name: string): Promise<SharePerson> {
  return { ...user, id: await userIdOf(request, user.token), name };
}

/**
 * Builds the scene once per file: the G1-09 matrix (organization A with an
 * owner, an admin, two members, a member of the second workspace and a
 * deactivated one; organization B with an owner and a member) and `extraCount`
 * more organization members of A in the document workspace.
 */
export async function buildShareScene(page: Page, tag: string, extraCount: number): Promise<ShareScene> {
  const m = await documentMatrix(page, api, tag);
  const req = page.request;
  const extras: SharePerson[] = [];
  for (let i = 1; i <= extraCount; i += 1) {
    const extraTag = `${tag}-x${String(i).padStart(2, "0")}`;
    const user = await registerFolderUser(page, extraTag);
    await inviteAndAccept(page, api, m.aOwner.token, m.aOwner.wsId, user);
    extras.push(await person(req, user, extraTag));
  }
  return {
    m,
    owner: await person(req, m.aOwner, `${tag}-a-owner`),
    member: await person(req, m.aMember, `${tag}-a-member`),
    other: await person(req, m.aOther, `${tag}-a-other`),
    admin: await person(req, m.aAdmin, `${tag}-a-admin`),
    outside: await person(req, m.aOutside, `${tag}-a-outside`),
    foreign: await person(req, m.bMember, `${tag}-b-member`),
    extras,
  };
}

/** A root page of the owner's workspace. Private at create (U-SH2) unless `visibility` says otherwise. */
export async function createDoc(
  request: APIRequestContext,
  token: string,
  wsId: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const created = await request.post(`${api}/api/v1/workspaces/${wsId}/documents`, {
    headers: authHeaders(token),
    data: { kind: "page", title, ...extra },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { document: { id: string } }).document.id;
}

export function readDoc(request: APIRequestContext, token: string, docId: string): Promise<APIResponse> {
  return request.get(`${api}/api/v1/documents/${docId}`, { headers: authHeaders(token) });
}

export function putAccess(
  request: APIRequestContext,
  token: string,
  docId: string,
  items: AccessItem[],
  dryRun = false,
): Promise<APIResponse> {
  return request.put(`${api}/api/v1/documents/${docId}/access`, {
    headers: authHeaders(token),
    data: { items, dry_run: dryRun },
  });
}

/** A PUT /access that must succeed; returns the 200 body. */
export async function grantAccess(
  request: APIRequestContext,
  token: string,
  docId: string,
  items: AccessItem[],
): Promise<AccessResult> {
  const res = await putAccess(request, token, docId, items);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as AccessResult;
}

export async function sharesOf(request: APIRequestContext, token: string, docId: string): Promise<AccessBody> {
  const res = await request.get(`${api}/api/v1/documents/${docId}/shares`, { headers: authHeaders(token) });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as AccessBody;
}

export async function candidatesOf(
  request: APIRequestContext,
  token: string,
  docId: string,
  q = "",
): Promise<Candidate[]> {
  const res = await request.get(`${api}/api/v1/documents/${docId}/share-candidates?q=${encodeURIComponent(q)}`, {
    headers: authHeaders(token),
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: Candidate[] }).items;
}

export async function rejectedOf(res: APIResponse): Promise<{ code: string; rejected: RejectedItem[]; text: string }> {
  const text = await res.text();
  const body = JSON.parse(text) as { error: { code: string; fields?: { rejected?: RejectedItem[] } } };
  return { code: body.error.code, rejected: body.error.fields?.rejected ?? [], text };
}

export const userItem = (p: SharePerson, level: AccessItem["level"], onExisting?: AccessItem["on_existing"]): AccessItem => ({
  principal_type: "user",
  principal_id: p.id,
  level,
  ...(onExisting ? { on_existing: onExisting } : {}),
});

/** The home workspace row and the organization, with the names the popup shows. */
export async function groupTargets(
  request: APIRequestContext,
  token: string,
  docId: string,
): Promise<{ homeId: string; homeName: string; orgId: string; orgName: string }> {
  const all = await candidatesOf(request, token, docId);
  const home = all.find((c) => c.principal_type === "workspace" && c.is_home_workspace);
  const org = all.find((c) => c.principal_type === "organization");
  expect(home, "share-candidates lists the home workspace").toBeTruthy();
  expect(org, "share-candidates lists the organization").toBeTruthy();
  return { homeId: home!.principal_id, homeName: home!.name, orgId: org!.principal_id, orgName: org!.name };
}

/** One level the user holds on a document, through every path ("" when none: 403/404 reads). */
export async function levelOf(request: APIRequestContext, token: string, docId: string): Promise<string> {
  const res = await readDoc(request, token, docId);
  if (res.status() !== 200) return "";
  return ((await res.json()) as { document: { my_level?: string } }).document.my_level ?? "";
}

export async function inboxOf(request: APIRequestContext, token: string): Promise<NotificationRow[]> {
  const res = await request.get(`${api}/api/v1/me/notifications?limit=50`, { headers: authHeaders(token) });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { notifications: NotificationRow[] }).notifications;
}

/** The slugs of an account's organization and workspace (DocumentMatrix.aOwner). */
interface WorkspaceRoute {
  orgSlug: string;
  wsSlug: string;
}

export function docPath(w: WorkspaceRoute, docId: string): string {
  return `/${w.orgSlug}/${w.wsSlug}/documents/${docId}`;
}

export function shareDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /^Chia sẻ “/ });
}

/** Opens a document and its Share dialog from the header menu (a manager's route). */
export async function openShareDialog(page: Page, w: WorkspaceRoute, docId: string): Promise<Locator> {
  await page.goto(docPath(w, docId));
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Chia sẻ");
  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("heading", { name: "Người và nhóm có quyền" })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/** Area 1: search the unified combobox and pick one result as a chip. */
export async function pickCandidate(dialog: Locator, query: string, option: string | RegExp): Promise<void> {
  const combo = dialog.getByRole("combobox", { name: "Chọn đối tượng" });
  await combo.click();
  await combo.fill(query);
  await dialog.getByRole("option", { name: option }).first().click();
}

export function chipList(dialog: Locator): Locator {
  return dialog.getByRole("list", { name: "Người đã chọn" });
}

/** The Area 1 submit button; "Chia sẻ" also heads the dialog, so the role narrows it. */
export function submitShare(dialog: Locator): Locator {
  return dialog.getByRole("button", { name: "Chia sẻ", exact: true });
}

/** The row of the library table for a title, once the list has it. */
export function libraryBadge(row: Locator): Locator {
  return row.getByTestId("document-share-scope-badge").filter({ visible: true }).first();
}

/**
 * A second, independent browser session signed in as `email`. A copy of
 * another session's storage state would share its rotating refresh token, so
 * each person signs in on their own context (documents-onboard.signIn).
 */
export async function openSession(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "vi-VN", storageState: VI_LOCALE_STATE });
  const page = await context.newPage();
  await loginViaUi(page, email);
  return { context, page };
}

const stamp = Date.now();
let titleSeq = 0;

/** A document title unique to this run and call: the Share dialog and library rows are found by it. */
export function docTitle(ac: string): string {
  titleSeq += 1;
  return `SH-E2E ${ac} ${stamp}-${titleSeq}`;
}

/** A fresh root page of the scene's owner; private at create (U-SH2). */
export async function ownerDoc(
  request: APIRequestContext,
  s: ShareScene,
  ac: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; title: string }> {
  const title = docTitle(ac);
  return { id: await createDoc(request, s.m.aOwner.token, s.m.aOwner.wsId, title, extra), title };
}

/** The owner signs in on a desktop-wide window, where the library shows its access column. */
export async function signInOwner(page: Page, s: ShareScene): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginViaUi(page, s.owner.email);
}

/** A name as the popup lists it, not followed by another digit (x1 must not match x10). */
export function who(name: string): RegExp {
  return new RegExp(`${escapeRegExp(name)}(?!\\d)`);
}

export async function toast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 30_000 });
}
