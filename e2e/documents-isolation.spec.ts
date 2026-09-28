import { expect, test, type APIRequestContext } from "@playwright/test";
import { documentMatrix, type DocumentMatrix } from "./documents-fixtures";
import { loginViaUi } from "./meeting-recording-fixture";

/**
 * Cross-cutting §7 matrix rows of G1-09 on the flows already on the root:
 * organization/workspace isolation over read, history, comments and download
 * (API and UI), two saves from one base, create idempotency, and the page
 * flow as a plain member - never an admin. The fixture scene is built once in
 * `beforeAll`; the Go twin of the scene and its rows is
 * server/internal/service/document_fixtures_test.go.
 *
 * Needs a running app whose API has the `documents` flag ON (FF_DOCUMENTS),
 * Postgres + Redis + storage up, and this worktree's migrations applied. The
 * exact commands live in reports/g1-09-integration-ops/ (run folder).
 */
test.describe.configure({ timeout: 360_000 });

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const stamp = Date.now();
const DOCUMENT_URL = /\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/;

let m: DocumentMatrix;
let pageDocId: string;
let pageDocTitle: string;
let ownerDocUrl: string;
let restrictedDocUrl: string;

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function createPage(
  request: APIRequestContext,
  token: string,
  wsId: string,
  data: Record<string, unknown>,
  idempotencyKey?: string,
) {
  return request.post(`${api}/api/v1/workspaces/${wsId}/documents`, {
    headers: { ...authHeaders(token), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    data: { kind: "page", ...data },
  });
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    m = await documentMatrix(page, api, `g109-iso-${stamp}`);
    pageDocTitle = `G1-09 isolation ${stamp}`;
    const created = await createPage(page.request, m.aOwner.token, m.aOwner.wsId, { title: pageDocTitle });
    expect(created.status(), await created.text()).toBe(201);
    pageDocId = ((await created.json()) as { document: { id: string } }).document.id;
    ownerDocUrl = `/${m.aOwner.orgSlug}/${m.aOwner.wsSlug}/documents/${pageDocId}`;

    const restricted = await createPage(page.request, m.aMember.token, m.aOwner.wsId, {
      title: `G1-09 restricted ${stamp}`,
      visibility: "restricted",
    });
    expect(restricted.status(), await restricted.text()).toBe(201);
    const restrictedId = ((await restricted.json()) as { document: { id: string } }).document.id;
    restrictedDocUrl = `/${m.aOwner.orgSlug}/${m.aOwner.wsSlug}/documents/${restrictedId}`;
  } finally {
    await page.close();
  }
});

test("another organization answers not found across read, history, comments and download", async ({ request }) => {
  const h = authHeaders(m.bMember.token);
  const read = await request.get(`${api}/api/v1/documents/${pageDocId}`, { headers: h });
  expect(read.status()).toBe(404);
  expect(((await read.json()) as { error: { code: string } }).error.code).toBe("not_found");

  const versions = await request.get(`${api}/api/v1/documents/${pageDocId}/versions`, { headers: h });
  expect(versions.status()).toBe(404);
  const comments = await request.get(`${api}/api/v1/documents/${pageDocId}/comments`, { headers: h });
  expect(comments.status()).toBe(404);
  const download = await request.get(`${api}/api/v1/documents/${pageDocId}/download`, { headers: h });
  expect(download.status()).toBe(404);

  // A write from the other tenant changes nothing.
  const write = await request.patch(`${api}/api/v1/documents/${pageDocId}`, {
    headers: h,
    data: { revision: "1", title: "hijacked" },
  });
  expect(write.status()).toBe(404);
  const asOwner = await request.get(`${api}/api/v1/documents/${pageDocId}`, { headers: authHeaders(m.aOwner.token) });
  expect(asOwner.status()).toBe(200);
  expect(((await asOwner.json()) as { document: { title: string } }).document.title).toBe(pageDocTitle);
});

test("an organization member outside the document workspace answers not found", async ({ request }) => {
  const h = authHeaders(m.aOutside.token);
  const read = await request.get(`${api}/api/v1/documents/${pageDocId}`, { headers: h });
  expect(read.status()).toBe(404);
  const versions = await request.get(`${api}/api/v1/documents/${pageDocId}/versions`, { headers: h });
  expect(versions.status()).toBe(404);
  const comments = await request.get(`${api}/api/v1/documents/${pageDocId}/comments`, { headers: h });
  expect(comments.status()).toBe(404);
});

test("an account in no organization answers not found", async ({ request }) => {
  const h = authHeaders(m.publicUser.token);
  const read = await request.get(`${api}/api/v1/documents/${pageDocId}`, { headers: h });
  expect(read.status()).toBe(404);
  const write = await request.patch(`${api}/api/v1/documents/${pageDocId}`, {
    headers: h,
    data: { revision: "1", title: "hijacked" },
  });
  expect(write.status()).toBe(404);
});

test("a deactivated member is refused with member_deactivated", async ({ request }) => {
  const h = authHeaders(m.aDeact.token);
  const read = await request.get(`${api}/api/v1/documents/${pageDocId}`, { headers: h });
  expect(read.status()).toBe(403);
  expect(((await read.json()) as { error: { code: string } }).error.code).toBe("member_deactivated");
});

test("two saves from one base: the first wins, the stale one conflicts", async ({ request }) => {
  const h = authHeaders(m.aMember.token);
  const content = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const first = await request.patch(`${api}/api/v1/documents/${pageDocId}`, {
    headers: h,
    data: { revision: "1", content: content("first save") },
  });
  expect(first.status()).toBe(200);
  expect(((await first.json()) as { document: { revision: string } }).document.revision).toBe("2");

  const stale = await request.patch(`${api}/api/v1/documents/${pageDocId}`, {
    headers: h,
    data: { revision: "1", content: content("stale save") },
  });
  expect(stale.status()).toBe(422);
  const body = (await stale.json()) as { error: { code: string; fields?: { current_revision?: string } } };
  expect(body.error.code).toBe("revision_conflict");
  expect(body.error.fields?.current_revision).toBe("2");
});

test("a create replay returns the same page; a changed payload under the same key is refused", async ({ request }) => {
  const key = `g109-idem-${stamp}`;
  const title = `G1-09 idempotent ${stamp}`;
  const first = await createPage(request, m.aOwner.token, m.aOwner.wsId, { title }, key);
  expect(first.status()).toBe(201);
  const id = ((await first.json()) as { document: { id: string } }).document.id;

  const replay = await createPage(request, m.aOwner.token, m.aOwner.wsId, { title }, key);
  expect(replay.status()).toBe(201);
  expect(((await replay.json()) as { document: { id: string } }).document.id).toBe(id);

  const mismatch = await createPage(request, m.aOwner.token, m.aOwner.wsId, { title: `${title} v2` }, key);
  expect(mismatch.status()).toBe(409);
  expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe("idempotency_payload_mismatch");
});

test("a plain member creates, types and reloads a page in the browser", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginViaUi(page, m.aMember.email);
  await page.goto(`/${m.aOwner.orgSlug}/${m.aOwner.wsSlug}/documents`);
  await expect(page.getByRole("heading", { name: "Tài liệu", level: 1 })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Trang mới" }).first().click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });
  const surface = page.getByRole("textbox", { name: "Nội dung tài liệu" });
  await expect(surface).toBeVisible({ timeout: 60_000 });
  await surface.click();
  await page.keyboard.type(`Biên bản G1-09 ${stamp}`);
  await expect(page.getByText(/^Đã lưu/)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toContainText(
    `Biên bản G1-09 ${stamp}`,
    { timeout: 60_000 },
  );
});

test("a workspace member without access sees the not-found screen, not the content", async ({ page }) => {
  await loginViaUi(page, m.aOther.email);
  await page.goto(restrictedDocUrl);
  await expect(page.getByText("Không tìm thấy tài liệu này")).toBeVisible({ timeout: 60_000 });
});

test("the other organization's shell sends a foreign document URL to the picker", async ({ page }) => {
  await loginViaUi(page, m.bOwner.email);
  await page.goto(ownerDocUrl);
  await expect(page).toHaveURL(/\/workspaces$/, { timeout: 60_000 });
  await expect(page.getByText(pageDocTitle)).toHaveCount(0);
});
