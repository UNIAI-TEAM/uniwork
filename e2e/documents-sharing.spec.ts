import { expect, test, type APIRequestContext } from "@playwright/test";
import { documentMatrix, type DocumentMatrix } from "./documents-fixtures";

/**
 * G1-09 §7 matrix rows for the G1-05b sharing surface, over the HTTP API:
 * a cross-workspace grant reaches an organization member outside the
 * document workspace and its revoke takes it away; a principal from another
 * organization is refused; a public link is readable anonymously only while
 * the link is live and the organization switch is on, and a closed link
 * answers exactly like an unknown token. The share/link screens belong to
 * lanes 05b/08; this file pins the isolation contract under them.
 *
 * Same runtime needs as documents-isolation.spec.ts (FF_DOCUMENTS on, the
 * worktree's migrations applied - the starter plan grants
 * documents.public_links, the organization switch starts closed).
 */
test.describe.configure({ mode: "serial", timeout: 360_000 });

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const stamp = Date.now();

let m: DocumentMatrix;
let docId: string;
let docTitle: string;

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function userId(request: APIRequestContext, token: string): Promise<string> {
  const me = await request.get(`${api}/api/v1/me`, { headers: authHeaders(token) });
  expect(me.status(), await me.text()).toBe(200);
  return ((await me.json()) as { user: { id: string } }).user.id;
}

async function errorCode(res: { json(): Promise<unknown> }): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    m = await documentMatrix(page, api, `g109-share-${stamp}`);
    docTitle = `G1-09 sharing ${stamp}`;
    const created = await page.request.post(`${api}/api/v1/workspaces/${m.aOwner.wsId}/documents`, {
      headers: authHeaders(m.aMember.token),
      data: { kind: "page", title: docTitle, visibility: "restricted" },
    });
    expect(created.status(), await created.text()).toBe(201);
    docId = ((await created.json()) as { document: { id: string } }).document.id;
  } finally {
    await page.close();
  }
});

test("a cross-workspace grant reaches the recipient and its revoke takes it away", async ({ request }) => {
  const outside = authHeaders(m.aOutside.token);
  const before = await request.get(`${api}/api/v1/documents/${docId}`, { headers: outside });
  expect(before.status()).toBe(404);

  const recipientId = await userId(request, m.aOutside.token);
  const shared = await request.post(`${api}/api/v1/documents/${docId}/shares`, {
    headers: authHeaders(m.aMember.token),
    data: { principal_type: "user", principal_id: recipientId, level: "view" },
  });
  expect(shared.status(), await shared.text()).toBe(201);
  const shareId = ((await shared.json()) as { share: { id: string } }).share.id;

  const read = await request.get(`${api}/api/v1/documents/${docId}`, { headers: outside });
  expect(read.status()).toBe(200);
  expect(((await read.json()) as { document: { title: string } }).document.title).toBe(docTitle);
  // A view grant never lets the recipient write.
  const write = await request.patch(`${api}/api/v1/documents/${docId}`, {
    headers: outside,
    data: { revision: "1", title: "hijacked" },
  });
  expect(write.status()).toBe(403);

  const listed = await request.get(`${api}/api/v1/workspaces/${m.aWS2Id}/documents/shared-with-me`, {
    headers: outside,
  });
  expect(listed.status(), await listed.text()).toBe(200);
  expect(await listed.text()).toContain(docId);

  const revoked = await request.delete(`${api}/api/v1/documents/${docId}/shares/${shareId}`, {
    headers: authHeaders(m.aMember.token),
  });
  expect(revoked.status(), await revoked.text()).toBe(200);
  const after = await request.get(`${api}/api/v1/documents/${docId}`, { headers: outside });
  expect(after.status()).toBe(404);
});

test("a principal from another organization cannot be granted access", async ({ request }) => {
  const foreignId = await userId(request, m.bMember.token);
  const shared = await request.post(`${api}/api/v1/documents/${docId}/shares`, {
    headers: authHeaders(m.aMember.token),
    data: { principal_type: "user", principal_id: foreignId, level: "view" },
  });
  expect(shared.status()).toBe(422);
  expect(await errorCode(shared)).toBe("principal_not_in_organization");
  const read = await request.get(`${api}/api/v1/documents/${docId}`, { headers: authHeaders(m.bMember.token) });
  expect(read.status()).toBe(404);
});

test("the other organization cannot manage the document's access", async ({ request }) => {
  const h = authHeaders(m.bOwner.token);
  const list = await request.get(`${api}/api/v1/documents/${docId}/shares`, { headers: h });
  expect(list.status()).toBe(404);
  const link = await request.post(`${api}/api/v1/documents/${docId}/links`, { headers: h, data: {} });
  expect(link.status()).toBe(404);
  const logs = await request.get(`${api}/api/v1/documents/${docId}/access-logs`, { headers: h });
  expect(logs.status()).toBe(404);
});

test("a public link reads anonymously only while it is live and the switch is on", async ({ playwright, request }) => {
  const owner = authHeaders(m.aMember.token);
  const closed = await request.post(`${api}/api/v1/documents/${docId}/links`, { headers: owner, data: {} });
  expect(closed.status(), "the organization switch starts closed").toBe(403);
  expect(await errorCode(closed)).toBe("document_links_disabled");

  const on = await request.put(`${api}/api/v1/orgs/${m.aOwner.orgId}/documents/settings`, {
    headers: authHeaders(m.aOwner.token),
    data: { public_links_enabled: true },
  });
  expect(on.status(), await on.text()).toBe(200);

  const created = await request.post(`${api}/api/v1/documents/${docId}/links`, {
    headers: owner,
    data: { expires_in_days: 1 },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { token, link } = (await created.json()) as { token: string; link: { id: string } };

  // A fixed correlation id keeps the echoed provenance deterministic, so the
  // closed-link bodies can be compared byte for byte with the unknown token.
  const anon = await playwright.request.newContext({ extraHTTPHeaders: { "X-Correlation-ID": `g109-${stamp}` } });
  try {
    const unknown = await anon.get(`${api}/api/v1/public/documents/${"x".repeat(token.length)}`);
    expect(unknown.status()).toBe(404);
    const unknownBody = await unknown.text();

    const view = await anon.get(`${api}/api/v1/public/documents/${token}`);
    expect(view.status(), await view.text()).toBe(200);
    expect(((await view.json()) as { document: { title: string } }).document.title).toBe(docTitle);

    const off = await request.put(`${api}/api/v1/orgs/${m.aOwner.orgId}/documents/settings`, {
      headers: authHeaders(m.aOwner.token),
      data: { public_links_enabled: false },
    });
    expect(off.status()).toBe(200);
    const switchedOff = await anon.get(`${api}/api/v1/public/documents/${token}`);
    expect(switchedOff.status()).toBe(404);
    expect(await switchedOff.text()).toBe(unknownBody);

    const reopened = await request.put(`${api}/api/v1/orgs/${m.aOwner.orgId}/documents/settings`, {
      headers: authHeaders(m.aOwner.token),
      data: { public_links_enabled: true },
    });
    expect(reopened.status()).toBe(200);
    const again = await anon.get(`${api}/api/v1/public/documents/${token}`);
    expect(again.status()).toBe(200);

    const revoked = await request.delete(`${api}/api/v1/documents/${docId}/links/${link.id}`, { headers: owner });
    expect(revoked.status(), await revoked.text()).toBe(200);
    const gone = await anon.get(`${api}/api/v1/public/documents/${token}`);
    expect(gone.status()).toBe(404);
    expect(await gone.text()).toBe(unknownBody);
  } finally {
    await anon.dispose();
  }
});
