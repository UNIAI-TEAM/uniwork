import {
  expect,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { e2eApiUrl } from "./api-url";
import { VERIFICATION_CODE } from "./auth-nav";
import {
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
} from "./meeting-recording-fixture";

/**
 * Locates the table row (`tbody tr`) in the Documents library / folder content table
 * (`packages/views/documents/documents-library-list.tsx:135` `aria-label="Tài liệu"`)
 * containing the exact title text.
 */
export function contentRow(page: Page, title: string): Locator {
  return page
    .getByRole("table", { name: "Tài liệu" })
    .locator("tbody tr")
    .filter({ has: page.getByText(title, { exact: true }) });
}

/**
 * Locates the primary open/drag button inside a Documents library row.
 */
export function contentRowOpen(page: Page, title: string): Locator {
  return contentRow(page, title).getByRole("button").first();
}

const repoRoot =
  basename(process.cwd()).toLowerCase() === "e2e"
    ? resolve(process.cwd(), "..")
    : process.cwd();

const FIXTURE_FILES = {
  "fx-docx-report-vi": {
    path: resolve(repoRoot, "docs/office/g5g6g7/fixtures/fx-docx-report-vi.docx"),
    name: "fx-docx-report-vi.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  "fx-md-notes-vi": {
    path: resolve(repoRoot, "docs/office/g5g6g7/fixtures/fx-md-notes-vi.md"),
    name: "fx-md-notes-vi.md",
    mimeType: "text/markdown",
  },
  "fx-xlsx-revenue-xyz": {
    path: resolve(
      repoRoot,
      "docs/office/g5g6g7/fixtures/fx-xlsx-revenue-xyz.xlsx",
    ),
    name: "fx-xlsx-revenue-xyz.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
} as const;

type FolderFixtureId = keyof typeof FIXTURE_FILES;

export function getFixtureFilePath(fixtureId: FolderFixtureId): string {
  return FIXTURE_FILES[fixtureId].path;
}

interface FolderTestUser {
  id: string;
  email: string;
  token: string;
}

interface FolderWorkspaceSetup {
  orgId: string;
  orgSlug: string;
  wsId: string;
  wsSlug: string;
  owner: FolderTestUser;
  member?: FolderTestUser;
  /** Additional workspace members (own tokens, own rate-limit buckets) for parallel seeding. */
  extraMembers: FolderTestUser[];
}

interface DocumentBreadcrumbDTO {
  id: string;
  title: string;
  icon: string | null;
}

interface DocumentDTO {
  id: string;
  organization_id: string;
  workspace_id: string;
  parent_id?: string | null;
  kind: "page" | "file" | "folder";
  title: string;
  icon?: string | null;
  visibility: "workspace" | "restricted";
  position: number;
  revision: string;
  current_version: number;
  archived_at?: string | null;
  my_level: "view" | "edit" | "manage";
  breadcrumbs?: DocumentBreadcrumbDTO[];
  /** RFC 3339 UTC with SECOND precision (server/internal/handler/document_collections.go:343). */
  updated_at?: string;
}

interface DocumentSummaryDTO {
  id: string;
  parent_id?: string | null;
  kind: "page" | "file" | "folder";
  title: string;
  visibility: "workspace" | "restricted";
  position: number;
  revision: string;
  current_version: number;
  archived_at?: string | null;
  my_level?: "view" | "edit" | "manage";
  path?: Array<{ id: string; title: string }>;
}

interface DocumentTreeNodeDTO {
  id: string;
  parent_id?: string | null;
  kind: "page" | "file" | "folder";
  title: string;
  position: number;
  revision: string;
  children: DocumentTreeNodeDTO[];
}

interface ApiErrorBody {
  code?: string;
  message?: string;
}

interface ApiCallResult<T> {
  status: number;
  ok: boolean;
  data?: T;
  error?: ApiErrorBody;
  rawText?: string;
}

interface ArchiveImpactDTO {
  folders: number;
  documents: number;
  total: number;
  max_nodes: number;
  too_large: boolean;
}

interface ArchiveResultDTO {
  document: DocumentDTO;
  batch_id: string;
  affected: string[];
}

interface DocumentSourceItemDTO {
  id: string;
  source: string;
  name: string;
  parent?: {
    kind: string;
    id: string;
    title: string;
    ref?: string;
  };
}

function authHeaders(
  token: string,
  idempotencyKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a request when the server's rate limiter returns 429 Too Many Requests,
 * honoring the Retry-After header (seconds) or falling back to 15s.
 */
async function requestWithRetry429(
  send: () => Promise<APIResponse>,
  maxRetries = 5,
): Promise<APIResponse> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await send();
    if (res.status() !== 429 || attempt >= maxRetries) {
      return res;
    }
    const retryAfterHeader = res.headers()["retry-after"];
    const retryAfterSec = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : Number.NaN;
    const waitMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000 + 1000
        : 15_000;
    await sleep(waitMs);
  }
}

async function parseApiResult<T>(
  res: APIResponse,
  extractData: (raw: Record<string, unknown>, ok: boolean) => T | undefined,
): Promise<ApiCallResult<T>> {
  const rawText = await res.text();
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    raw = { message: rawText };
  }
  const errObj = raw.error as ApiErrorBody | undefined;
  return {
    status: res.status(),
    ok: res.ok(),
    data: extractData(raw, res.ok()),
    error: errObj ?? {
      code: typeof raw.code === "string" ? raw.code : undefined,
      message: typeof raw.message === "string" ? raw.message : rawText,
    },
    rawText,
  };
}

async function fetchUserId(page: Page, token: string): Promise<string> {
  const res = await requestWithRetry429(() =>
    page.request.get(`${e2eApiUrl}/api/v1/me`, {
      headers: authHeaders(token),
    }),
  );
  const rawText = await res.text();
  expect(
    res.ok(),
    `GET /me failed: ${res.status()} ${rawText}`,
  ).toBeTruthy();
  const body = JSON.parse(rawText) as { user: { id: string } };
  return body.user.id;
}

// Same password as meeting-recording-fixture.ts, which loginViaUi signs in with.
const FOLDER_USER_PASSWORD = "password123";

/**
 * Registers and verifies a user like `registerApiUser`, but retries on 429:
 * /auth/register shares a 60/min per-IP credential limit with every parallel
 * worker, and A12 registers several extra members per run.
 */
async function registerFolderUser(
  page: Page,
  tag: string,
): Promise<{ token: string; email: string }> {
  const email = `${tag}-${Date.now()}@example.com`;
  const created = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/auth/register`, {
      data: { email, password: FOLDER_USER_PASSWORD, display_name: tag },
    }),
  );
  const createdText = await created.text();
  expect(
    created.ok(),
    `register ${email}: HTTP ${created.status()} ${createdText}`,
  ).toBeTruthy();
  const { access_token: token } = JSON.parse(createdText) as {
    access_token: string;
  };
  const verified = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/me/email/verify`, {
      headers: authHeaders(token),
      data: { code: VERIFICATION_CODE },
    }),
  );
  expect(
    verified.ok(),
    `verify ${email}: HTTP ${verified.status()} ${await verified.text()}`,
  ).toBeTruthy();
  return { token, email };
}

async function addWorkspaceMember(
  page: Page,
  owner: { token: string; wsId: string },
  tag: string,
): Promise<FolderTestUser> {
  const peer = await registerFolderUser(page, tag);
  await joinWorkspaceAsMember(page, e2eApiUrl, owner.token, owner.wsId, peer);
  const done = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/me/onboarding/complete`, {
      headers: authHeaders(peer.token),
    }),
  );
  const doneText = await done.text();
  expect(
    done.ok(),
    `complete onboarding ${tag}: ${done.status()} ${doneText}`,
  ).toBeTruthy();
  const id = await fetchUserId(page, peer.token);
  return { id, email: peer.email, token: peer.token };
}

/**
 * Registers user A (workspace owner) and optionally invites/accepts user B
 * (workspace member) in the same workspace via the HTTP API. `extraMembers`
 * adds more members (each with its own token, so its own rate-limit bucket).
 */
export async function seedFolderWorkspace(
  page: Page,
  tag: string,
  options?: { withMemberB?: boolean; extraMembers?: number },
): Promise<FolderWorkspaceSetup> {
  const accountA = await createRecordingAccount(page, e2eApiUrl, `${tag}-a`);
  const ownerId = await fetchUserId(page, accountA.token);
  const setup: FolderWorkspaceSetup = {
    orgId: accountA.orgId,
    orgSlug: accountA.orgSlug,
    wsId: accountA.wsId,
    wsSlug: accountA.wsSlug,
    owner: { id: ownerId, email: accountA.email, token: accountA.token },
    extraMembers: [],
  };
  const ownerAuth = { token: accountA.token, wsId: accountA.wsId };
  if (options?.withMemberB) {
    setup.member = await addWorkspaceMember(page, ownerAuth, `${tag}-b`);
  }
  for (let i = 0; i < (options?.extraMembers ?? 0); i += 1) {
    setup.extraMembers.push(
      await addWorkspaceMember(page, ownerAuth, `${tag}-s${i + 1}`),
    );
  }
  return setup;
}

export async function loginFolderUser(
  page: Page,
  email: string,
): Promise<void> {
  await loginViaUi(page, email);
}

export async function apiCreateDocument(
  page: Page,
  token: string,
  wsId: string,
  input: {
    title: string;
    kind?: "page" | "folder";
    parent_id?: string | null;
    visibility?: "workspace" | "restricted";
    content?: unknown;
  },
  idempotencyKey?: string,
): Promise<ApiCallResult<DocumentDTO>> {
  const key =
    idempotencyKey ??
    `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/workspaces/${wsId}/documents`, {
      headers: {
        ...authHeaders(token, key),
        "content-type": "application/json",
      },
      data: input,
    }),
  );
  const parsed = await parseApiResult(res, (raw) => raw.document as DocumentDTO | undefined);
  if (parsed.ok && parsed.data && !input.parent_id && input.visibility !== "restricted") {
    return { ...parsed, data: await openRootDocumentToWorkspace(page, token, wsId, parsed.data.id) };
  }
  return parsed;
}

/**
 * A root document is private at create since U-SH2 (SH-S1, 1cd4497d9) and a
 * named "workspace" opens it at view only. These specs seed what they mean
 * by a plain create: a document every workspace member may edit, the
 * pre-SH-S1 default. The workspace share writes the home row at edit; a
 * child created under it inherits both, so only roots need the call. The
 * share bumps the revision, so the returned document is read again: the
 * callers pass its revision to move and rename.
 */
async function openRootDocumentToWorkspace(
  page: Page,
  token: string,
  wsId: string,
  docId: string,
): Promise<DocumentDTO> {
  const res = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/documents/${docId}/shares`, {
      headers: { ...authHeaders(token), "content-type": "application/json" },
      data: { principal_type: "workspace", principal_id: wsId, level: "edit" },
    }),
  );
  expect(
    res.ok(),
    `open ${docId} to the workspace failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const fresh = await getDocument(page, token, docId);
  expect(fresh.ok && fresh.data, `getDocument(${docId}): ${fresh.status}`).toBeTruthy();
  return fresh.data!;
}

export async function createFolder(
  page: Page,
  token: string,
  wsId: string,
  title: string,
  parentId?: string | null,
  visibility?: "workspace" | "restricted",
): Promise<DocumentDTO> {
  const res = await apiCreateDocument(page, token, wsId, {
    title,
    kind: "folder",
    parent_id: parentId ?? undefined,
    visibility,
  });
  expect(
    res.ok && res.data,
    `createFolder(${title}) failed: ${res.status} ${JSON.stringify(res.error)} ${res.rawText ?? ""}`,
  ).toBeTruthy();
  return res.data!;
}

export async function createPage(
  page: Page,
  token: string,
  wsId: string,
  title: string,
  parentId?: string | null,
  options?: { visibility?: "workspace" | "restricted"; bodyText?: string },
): Promise<DocumentDTO> {
  const content = options?.bodyText
    ? {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: options.bodyText }],
          },
        ],
      }
    : undefined;
  const res = await apiCreateDocument(page, token, wsId, {
    title,
    kind: "page",
    parent_id: parentId ?? undefined,
    visibility: options?.visibility,
    content,
  });
  expect(
    res.ok && res.data,
    `createPage(${title}) failed: ${res.status} ${JSON.stringify(res.error)} ${res.rawText ?? ""}`,
  ).toBeTruthy();
  return res.data!;
}

export async function uploadFixtureFile(
  page: Page,
  token: string,
  wsId: string,
  fixtureId: FolderFixtureId,
  options?: { parentId?: string | null; filename?: string; title?: string },
): Promise<DocumentDTO> {
  const meta = FIXTURE_FILES[fixtureId];
  // server/internal/handler/documents.go:71-73,86-120 (documentUploadForm) reads
  // text fields only while they precede the "file" part; anything after "file" is dropped.
  const multipart: Record<string, unknown> = {};
  if (options?.parentId) multipart.parent_id = options.parentId;
  if (options?.title) multipart.title = options.title;
  multipart.file = {
    name: options?.filename ?? meta.name,
    mimeType: meta.mimeType,
    buffer: readFileSync(meta.path),
  };
  const key = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await requestWithRetry429(() =>
    page.request.post(
      `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents/files`,
      {
        headers: authHeaders(token, key),
        multipart: multipart as Parameters<typeof page.request.post>[1] extends
          | { multipart?: infer M }
          | undefined
          ? M
          : never,
      },
    ),
  );
  const rawText = await res.text();
  expect(
    res.ok(),
    `uploadFixtureFile(${fixtureId}) failed: ${res.status()} ${rawText}`,
  ).toBeTruthy();
  const body = JSON.parse(rawText) as { document: DocumentDTO };
  if (!options?.parentId) {
    return openRootDocumentToWorkspace(page, token, wsId, body.document.id);
  }
  return body.document;
}

export async function createFolderChain(
  page: Page,
  token: string,
  wsId: string,
  depth: number,
  prefix: string,
): Promise<DocumentDTO[]> {
  const chain: DocumentDTO[] = [];
  let parentId: string | null = null;
  for (let i = 1; i <= depth; i += 1) {
    const folder = await createFolder(
      page,
      token,
      wsId,
      `${prefix}-L${String(i).padStart(2, "0")}`,
      parentId,
    );
    chain.push(folder);
    parentId = folder.id;
  }
  return chain;
}

/**
 * Seeds `count` child pages under `rootFolderId` in parallel with one token per
 * lane. The global limiter keys by bearer token (300/min per token,
 * `server/internal/handler/router/router.go:90`), so spreading the work over
 * several workspace members keeps every token far below its budget; a 429 is
 * still retried after its Retry-After. Returns the elapsed milliseconds.
 */
export async function seedFolderSubtreeParallel(
  page: Page,
  tokens: string[],
  wsId: string,
  rootFolderId: string,
  count: number,
  prefix: string,
  concurrencyPerToken = 4,
): Promise<number> {
  expect(tokens.length, "at least one token to seed with").toBeGreaterThan(0);
  const startedAt = Date.now();
  let next = 0;
  const lane = async (token: string): Promise<void> => {
    while (next < count) {
      const idx = next;
      next += 1;
      await createPage(
        page,
        token,
        wsId,
        `${prefix}-${idx + 1}`,
        rootFolderId,
      );
    }
  };
  await Promise.all(
    tokens.flatMap((token) =>
      Array.from({ length: concurrencyPerToken }, () => lane(token)),
    ),
  );
  return Date.now() - startedAt;
}

/**
 * The server serializes `updated_at` with second precision, so two writes in the
 * same wall-clock second tie and the order of tied rows under "Cập nhật (mới nhất)"
 * is undefined. Waits (bounded) until the clock is in a later second than `updatedAt`,
 * so the next write is stamped distinctly. No-op without a previous stamp.
 */
export async function waitPastUpdatedSecond(
  updatedAt: string | undefined,
): Promise<void> {
  if (!updatedAt) return;
  const stamped = Math.floor(Date.parse(updatedAt) / 1000);
  expect(Number.isFinite(stamped), `updated_at parses: ${updatedAt}`).toBe(true);
  const deadline = Date.now() + 5_000;
  while (Math.floor(Date.now() / 1000) <= stamped && Date.now() < deadline) {
    await sleep(100);
  }
}

/**
 * Asserts `next` was stamped in a later second than `previous`, so a recency
 * order built on them has no ties. Fails with both stamps when it did not.
 */
export function expectLaterUpdatedAt(
  label: string,
  next: { updated_at?: string },
  previous: string | undefined,
): void {
  expect(next.updated_at, `${label} has updated_at`).toBeTruthy();
  if (!previous) return;
  expect(
    Math.floor(Date.parse(next.updated_at!) / 1000),
    `${label} updated_at ${next.updated_at} is later than the previous write ${previous}`,
  ).toBeGreaterThan(Math.floor(Date.parse(previous) / 1000));
}

/**
 * Asserts the rows of the Documents content table appear in this top-to-bottom
 * order. Rows are located through `contentRow` (table role + title text) and
 * compared by their rendered position, so the check reads what the viewer sees.
 */
export async function expectRowOrder(
  page: Page,
  titles: string[],
): Promise<void> {
  const tops: number[] = [];
  for (const title of titles) {
    const row = contentRow(page, title);
    await expect(row, `row ${title} is listed`).toHaveCount(1);
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box, `row ${title} has a box`).toBeTruthy();
    tops.push(box!.y);
  }
  const rendered = titles
    .map((title, i) => ({ title, top: tops[i]! }))
    .sort((a, b) => a.top - b.top)
    .map((r) => r.title);
  expect(rendered).toEqual(titles);
}

export async function getDocument(
  page: Page,
  token: string,
  docId: string,
): Promise<ApiCallResult<DocumentDTO>> {
  const res = await requestWithRetry429(() =>
    page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}`, {
      headers: authHeaders(token),
    }),
  );
  return parseApiResult(res, (raw) => raw.document as DocumentDTO | undefined);
}

export async function patchDocument(
  page: Page,
  token: string,
  docId: string,
  body: {
    revision: string;
    title?: string;
    visibility?: "workspace" | "restricted";
  },
): Promise<ApiCallResult<DocumentDTO>> {
  const res = await requestWithRetry429(() =>
    page.request.patch(`${e2eApiUrl}/api/v1/documents/${docId}`, {
      headers: {
        ...authHeaders(token),
        "content-type": "application/json",
      },
      data: body,
    }),
  );
  return parseApiResult(res, (raw) => raw.document as DocumentDTO | undefined);
}

export async function moveDocument(
  page: Page,
  token: string,
  docId: string,
  body: { parent_id?: string | null; position?: number; revision: string },
): Promise<ApiCallResult<DocumentDTO>> {
  const key = `move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/documents/${docId}/move`, {
      headers: {
        ...authHeaders(token, key),
        "content-type": "application/json",
      },
      data: body,
    }),
  );
  return parseApiResult(res, (raw) => raw.document as DocumentDTO | undefined);
}

export async function getArchiveImpact(
  page: Page,
  token: string,
  docId: string,
): Promise<ApiCallResult<ArchiveImpactDTO>> {
  const res = await requestWithRetry429(() =>
    page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}/archive-impact`, {
      headers: authHeaders(token),
    }),
  );
  return parseApiResult(res, (raw, ok) =>
    ok ? (raw as unknown as ArchiveImpactDTO) : undefined,
  );
}

export async function archiveDocument(
  page: Page,
  token: string,
  docId: string,
): Promise<ApiCallResult<ArchiveResultDTO>> {
  const key = `arch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/documents/${docId}/archive`, {
      headers: authHeaders(token, key),
    }),
  );
  return parseApiResult(res, (raw, ok) =>
    ok ? (raw as unknown as ArchiveResultDTO) : undefined,
  );
}

export async function restoreDocument(
  page: Page,
  token: string,
  docId: string,
): Promise<ApiCallResult<ArchiveResultDTO>> {
  const key = `rest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/documents/${docId}/restore`, {
      headers: authHeaders(token, key),
    }),
  );
  return parseApiResult(res, (raw, ok) =>
    ok ? (raw as unknown as ArchiveResultDTO) : undefined,
  );
}

export async function listDocuments(
  page: Page,
  token: string,
  wsId: string,
  params?: {
    parent_id?: string;
    q?: string;
    match?: string;
    kind?: string;
    archived?: boolean;
    limit?: number;
  },
): Promise<{ documents: DocumentSummaryDTO[]; next_cursor: string }> {
  const search = new URLSearchParams();
  if (params?.parent_id !== undefined)
    search.set("parent_id", params.parent_id);
  if (params?.q !== undefined) search.set("q", params.q);
  if (params?.match !== undefined) search.set("match", params.match);
  if (params?.kind !== undefined) search.set("kind", params.kind);
  if (params?.archived) search.set("archived", "true");
  if (params?.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await requestWithRetry429(() =>
    page.request.get(
      `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents${qs ? `?${qs}` : ""}`,
      { headers: authHeaders(token) },
    ),
  );
  const rawText = await res.text();
  expect(
    res.ok(),
    `listDocuments(${qs}) failed: ${res.status()} ${rawText}`,
  ).toBeTruthy();
  return JSON.parse(rawText) as {
    documents: DocumentSummaryDTO[];
    next_cursor: string;
  };
}

export async function getDocumentTree(
  page: Page,
  token: string,
  wsId: string,
  params?: { root?: string; folders_only?: boolean },
): Promise<DocumentTreeNodeDTO[]> {
  const search = new URLSearchParams();
  if (params?.root) search.set("root", params.root);
  if (params?.folders_only) search.set("folders_only", "true");
  const qs = search.toString();
  const res = await requestWithRetry429(() =>
    page.request.get(
      `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents/tree${qs ? `?${qs}` : ""}`,
      { headers: authHeaders(token) },
    ),
  );
  const rawText = await res.text();
  expect(
    res.ok(),
    `getDocumentTree(${qs}) failed: ${res.status()} ${rawText}`,
  ).toBeTruthy();
  const body = JSON.parse(rawText) as { documents: DocumentTreeNodeDTO[] };
  return body.documents;
}

export async function grantDocumentShare(
  page: Page,
  token: string,
  docId: string,
  principalId: string,
  level: "view" | "edit" | "manage",
): Promise<string> {
  const res = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/documents/${docId}/shares`, {
      headers: {
        ...authHeaders(token),
        "content-type": "application/json",
      },
      data: {
        principal_type: "user",
        principal_id: principalId,
        level,
      },
    }),
  );
  const rawText = await res.text();
  expect(
    res.ok(),
    `grantDocumentShare failed: ${res.status()} ${rawText}`,
  ).toBeTruthy();
  const body = JSON.parse(rawText) as { share: { id: string } };
  return body.share.id;
}

interface DocumentArtifactsSnapshot {
  versionNumbers: number[];
  commentIds: string[];
  shareIds: string[];
}

export async function seedDocumentArtifacts(
  page: Page,
  token: string,
  docId: string,
  shareUserId: string,
): Promise<DocumentDTO> {
  const docRes = await getDocument(page, token, docId);
  expect(
    docRes.ok && docRes.data,
    `seedDocumentArtifacts getDocument(${docId}): ${docRes.status} ${JSON.stringify(docRes.error)} ${docRes.rawText ?? ""}`,
  ).toBeTruthy();
  const doc = docRes.data!;
  if (doc.kind === "page") {
    // server/internal/service/document_versions.go:67-69: POST /documents/{id}/versions is for page documents only.
    const vKey = `ver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const vRes = await requestWithRetry429(() =>
      page.request.post(`${e2eApiUrl}/api/v1/documents/${docId}/versions`, {
        headers: {
          ...authHeaders(token, vKey),
          "content-type": "application/json",
        },
        data: { label: "v-before-move" },
      }),
    );
    const vText = await vRes.text();
    expect(
      vRes.ok(),
      `seed version: ${vRes.status()} ${vText}`,
    ).toBeTruthy();
  } else if (doc.kind === "file") {
    // server/internal/service/document_versions.go:67-69 & server/internal/handler/documents.go:259-320:
    // file documents create version 1 on upload and subsequent versions via /uploads + /versions/commit.
    const meta = FIXTURE_FILES["fx-docx-report-vi"];
    const upKey = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const upRes = await requestWithRetry429(() =>
      page.request.post(`${e2eApiUrl}/api/v1/documents/${docId}/uploads`, {
        headers: authHeaders(token, upKey),
        multipart: {
          file: {
            name: meta.name,
            mimeType: meta.mimeType,
            buffer: readFileSync(meta.path),
          },
        },
      }),
    );
    const upText = await upRes.text();
    expect(
      upRes.ok(),
      `stage file upload: ${upRes.status()} ${upText}`,
    ).toBeTruthy();
    const uploaded = JSON.parse(upText) as { upload_id: string };
    const commitKey = `commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const commitRes = await requestWithRetry429(() =>
      page.request.post(
        `${e2eApiUrl}/api/v1/documents/${docId}/versions/commit`,
        {
          headers: {
            ...authHeaders(token, commitKey),
            "content-type": "application/json",
          },
          data: {
            upload_id: uploaded.upload_id,
            base_revision: doc.revision,
          },
        },
      ),
    );
    const commitText = await commitRes.text();
    expect(
      commitRes.ok(),
      `commit file version: ${commitRes.status()} ${commitText}`,
    ).toBeTruthy();
  }
  const cRes = await requestWithRetry429(() =>
    page.request.post(`${e2eApiUrl}/api/v1/documents/${docId}/comments`, {
      headers: {
        ...authHeaders(token),
        "content-type": "application/json",
      },
      data: { body: "Ghi chú trước khi chuyển thư mục", kind: "discussion" },
    }),
  );
  const cText = await cRes.text();
  expect(
    cRes.ok(),
    `seed comment: ${cRes.status()} ${cText}`,
  ).toBeTruthy();
  await grantDocumentShare(page, token, docId, shareUserId, "view");
  const afterDoc = await getDocument(page, token, docId);
  expect(
    afterDoc.ok && afterDoc.data,
    `seedDocumentArtifacts refresh(${docId}): ${afterDoc.status} ${JSON.stringify(afterDoc.error)} ${afterDoc.rawText ?? ""}`,
  ).toBeTruthy();
  return afterDoc.data!;
}

export async function readDocumentArtifacts(
  page: Page,
  token: string,
  docId: string,
): Promise<DocumentArtifactsSnapshot> {
  const [vRes, cRes, sRes] = await Promise.all([
    requestWithRetry429(() =>
      page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}/versions`, {
        headers: authHeaders(token),
      }),
    ),
    requestWithRetry429(() =>
      page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}/comments`, {
        headers: authHeaders(token),
      }),
    ),
    requestWithRetry429(() =>
      page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}/shares`, {
        headers: authHeaders(token),
      }),
    ),
  ]);
  const [vText, cText, sText] = await Promise.all([
    vRes.text(),
    cRes.text(),
    sRes.text(),
  ]);
  expect(
    vRes.ok(),
    `versions(${docId}): ${vRes.status()} ${vText}`,
  ).toBeTruthy();
  expect(
    cRes.ok(),
    `comments(${docId}): ${cRes.status()} ${cText}`,
  ).toBeTruthy();
  expect(
    sRes.ok(),
    `shares(${docId}): ${sRes.status()} ${sText}`,
  ).toBeTruthy();
  const versions = JSON.parse(vText) as {
    versions: Array<{ version: number }>;
  };
  const comments = JSON.parse(cText) as { comments: Array<{ id: string }> };
  const shares = JSON.parse(sText) as { shares: Array<{ id: string }> };
  return {
    versionNumbers: versions.versions.map((v) => v.version),
    commentIds: comments.comments.map((c) => c.id),
    shareIds: shares.shares.map((s) => s.id),
  };
}

export async function listDocumentSources(
  page: Page,
  token: string,
  wsId: string,
  source?: "chat" | "task" | "meeting" | "email",
): Promise<DocumentSourceItemDTO[]> {
  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  const res = await requestWithRetry429(() =>
    page.request.get(
      `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents/sources${qs}`,
      { headers: authHeaders(token) },
    ),
  );
  const rawText = await res.text();
  expect(
    res.ok(),
    `listDocumentSources failed: ${res.status()} ${rawText}`,
  ).toBeTruthy();
  const body = JSON.parse(rawText) as { items?: DocumentSourceItemDTO[] };
  return body.items ?? [];
}

interface DocumentRefIds {
  taskId: string;
  meetingId: string;
  wsId: string;
  roomId: string;
  messageId: string;
}

function pickText(
  raw: unknown,
  wrapper: string,
  field: "description" | "title" | "body",
): string {
  const root = (raw ?? {}) as Record<string, unknown>;
  const inner = (root[wrapper] ?? root) as Record<string, unknown>;
  const value = inner[field];
  return typeof value === "string" ? value : "";
}

/**
 * Reads back the text of a task description, a meeting title and a chat message
 * body that each mention a document by its URL, through their own APIs.
 */
export async function readDocumentReferenceTexts(
  page: Page,
  token: string,
  refs: DocumentRefIds,
): Promise<{ task: string; meeting: string; chat: string }> {
  const get = async (url: string): Promise<unknown> => {
    const res = await requestWithRetry429(() =>
      page.request.get(url, { headers: authHeaders(token) }),
    );
    const text = await res.text();
    expect(res.ok(), `GET ${url}: ${res.status()} ${text}`).toBeTruthy();
    return JSON.parse(text) as unknown;
  };
  const [task, meeting, chat] = await Promise.all([
    get(`${e2eApiUrl}/api/v1/tasks/${refs.taskId}`),
    get(`${e2eApiUrl}/api/v1/meetings/${refs.meetingId}`),
    get(
      `${e2eApiUrl}/api/v1/workspaces/${refs.wsId}/chat/rooms/${refs.roomId}/messages/${refs.messageId}`,
    ),
  ]);
  return {
    task: pickText(task, "task", "description"),
    meeting: pickText(meeting, "meeting", "title"),
    chat: pickText(chat, "message", "body"),
  };
}

/** The document ids a text points at through `/documents/<id>` links, in order. */
export function documentIdsLinkedIn(text: string): string[] {
  return [...text.matchAll(/\/documents\/([0-9A-Za-z]+)/g)].map((m) => m[1]!);
}
