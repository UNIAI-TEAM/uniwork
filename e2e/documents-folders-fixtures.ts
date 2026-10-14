import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { e2eApiUrl } from "./api-url";
import {
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
} from "./meeting-recording-fixture";

const CONTENT_ROW_TYPE_LABELS = [
  "Thư mục",
  "Trang UniWork",
  "Tài liệu Word",
  "Bảng tính Excel",
  "Bản trình bày PowerPoint",
  "Tài liệu PDF",
  "Tài liệu Markdown",
  "Tài liệu HTML",
  "File",
].join("|");

/**
 * Locates the primary row button in the Documents library / folder content table
 * (`packages/views/documents/documents-library-list.tsx:135` `aria-label="Tài liệu"`,
 * `packages/views/documents/documents-library-row.tsx:198-211`, and
 * `packages/views/documents/document-type-icon.tsx:40-72`, which prefixes the
 * button's accessible name with `role="img" aria-label={t("documents.file_types.*")}`).
 */
export function contentRow(page: Page, title: string): Locator {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page
    .getByRole("table", { name: "Tài liệu" })
    .getByRole("button", {
      name: new RegExp(
        `^(?:(?:${CONTENT_ROW_TYPE_LABELS})\\s+)?${escaped}(?!\\s*\\(\\d+\\))(?:\\s|$)`,
      ),
    });
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

async function fetchUserId(page: Page, token: string): Promise<string> {
  const res = await page.request.get(`${e2eApiUrl}/api/v1/me`, {
    headers: authHeaders(token),
  });
  expect(
    res.ok(),
    `GET /me failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = (await res.json()) as { user: { id: string } };
  return body.user.id;
}

/**
 * Registers user A (workspace owner) and optionally invites/accepts user B
 * (workspace member) in the same workspace via the HTTP API.
 */
export async function seedFolderWorkspace(
  page: Page,
  tag: string,
  options?: { withMemberB?: boolean },
): Promise<FolderWorkspaceSetup> {
  const accountA = await createRecordingAccount(page, e2eApiUrl, `${tag}-a`);
  const ownerId = await fetchUserId(page, accountA.token);
  const setup: FolderWorkspaceSetup = {
    orgId: accountA.orgId,
    orgSlug: accountA.orgSlug,
    wsId: accountA.wsId,
    wsSlug: accountA.wsSlug,
    owner: { id: ownerId, email: accountA.email, token: accountA.token },
  };
  if (options?.withMemberB) {
    const peerB = await registerApiUser(page, e2eApiUrl, `${tag}-b`);
    await joinWorkspaceAsMember(
      page,
      e2eApiUrl,
      accountA.token,
      accountA.wsId,
      peerB,
      "member",
    );
    const done = await page.request.post(
      `${e2eApiUrl}/api/v1/me/onboarding/complete`,
      { headers: authHeaders(peerB.token) },
    );
    expect(
      done.ok(),
      `complete onboarding B: ${done.status()} ${await done.text()}`,
    ).toBeTruthy();
    const memberId = await fetchUserId(page, peerB.token);
    setup.member = { id: memberId, email: peerB.email, token: peerB.token };
  }
  return setup;
}

export async function loginFolderUser(
  page: Page,
  email: string,
): Promise<void> {
  await loginViaUi(page, email);
}

export function skipWithoutFd09(
  reason = "skip: needs FD-09 (UNI-1469)",
): void {
  if (!process.env.E2E_FD09) {
    console.log(reason);
    test.skip(true, reason);
  }
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
  const res = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents`,
    {
      headers: {
        ...authHeaders(
          token,
          idempotencyKey ??
            `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ),
        "content-type": "application/json",
      },
      data: input,
    },
  );
  const rawText = await res.text();
  const raw = JSON.parse(rawText) as {
    document?: DocumentDTO;
    error?: ApiErrorBody;
    code?: string;
    message?: string;
  };
  return {
    status: res.status(),
    ok: res.ok(),
    data: raw.document,
    error: raw.error ?? { code: raw.code, message: raw.message },
    rawText,
  };
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
    `createFolder(${title}) failed: ${res.status} ${JSON.stringify(res.error)}`,
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
    `createPage(${title}) failed: ${res.status} ${JSON.stringify(res.error)}`,
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
  const res = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents/files`,
    {
      headers: authHeaders(
        token,
        `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ),
      multipart: multipart as Parameters<typeof page.request.post>[1] extends
        | { multipart?: infer M }
        | undefined
        ? M
        : never,
    },
  );
  expect(
    res.ok(),
    `uploadFixtureFile(${fixtureId}) failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = (await res.json()) as { document: DocumentDTO };
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

export async function seedFolderSubtreeBatch(
  page: Page,
  token: string,
  wsId: string,
  rootFolderId: string,
  count: number,
  prefix: string,
  concurrency = 25,
): Promise<void> {
  let nextIdx = 0;
  const worker = async (): Promise<void> => {
    while (nextIdx < count) {
      const idx = nextIdx;
      nextIdx += 1;
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
    Array.from({ length: Math.min(concurrency, count) }, () => worker()),
  );
}

export async function getDocument(
  page: Page,
  token: string,
  docId: string,
): Promise<ApiCallResult<DocumentDTO>> {
  const res = await page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}`, {
    headers: authHeaders(token),
  });
  const raw = (await res.json()) as {
    document?: DocumentDTO;
    error?: ApiErrorBody;
    code?: string;
    message?: string;
  };
  return {
    status: res.status(),
    ok: res.ok(),
    data: raw.document,
    error: raw.error ?? { code: raw.code, message: raw.message },
  };
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
  const res = await page.request.patch(
    `${e2eApiUrl}/api/v1/documents/${docId}`,
    {
      headers: {
        ...authHeaders(token),
        "content-type": "application/json",
      },
      data: body,
    },
  );
  const rawText = await res.text();
  const raw = JSON.parse(rawText) as {
    document?: DocumentDTO;
    error?: ApiErrorBody;
    code?: string;
    message?: string;
  };
  return {
    status: res.status(),
    ok: res.ok(),
    data: raw.document,
    error: raw.error ?? { code: raw.code, message: raw.message },
    rawText,
  };
}

export async function moveDocument(
  page: Page,
  token: string,
  docId: string,
  body: { parent_id?: string | null; position?: number; revision: string },
): Promise<ApiCallResult<DocumentDTO>> {
  const res = await page.request.post(
    `${e2eApiUrl}/api/v1/documents/${docId}/move`,
    {
      headers: {
        ...authHeaders(
          token,
          `move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ),
        "content-type": "application/json",
      },
      data: body,
    },
  );
  const raw = (await res.json()) as {
    document?: DocumentDTO;
    error?: ApiErrorBody;
    code?: string;
    message?: string;
  };
  return {
    status: res.status(),
    ok: res.ok(),
    data: raw.document,
    error: raw.error ?? { code: raw.code, message: raw.message },
  };
}

export async function getArchiveImpact(
  page: Page,
  token: string,
  docId: string,
): Promise<ApiCallResult<ArchiveImpactDTO>> {
  const res = await page.request.get(
    `${e2eApiUrl}/api/v1/documents/${docId}/archive-impact`,
    { headers: authHeaders(token) },
  );
  const raw = (await res.json()) as ArchiveImpactDTO & {
    error?: ApiErrorBody;
    code?: string;
    message?: string;
  };
  return {
    status: res.status(),
    ok: res.ok(),
    data: res.ok() ? raw : undefined,
    error: raw.error ?? { code: raw.code, message: raw.message },
  };
}

export async function archiveDocument(
  page: Page,
  token: string,
  docId: string,
): Promise<ApiCallResult<ArchiveResultDTO>> {
  const res = await page.request.post(
    `${e2eApiUrl}/api/v1/documents/${docId}/archive`,
    {
      headers: authHeaders(
        token,
        `arch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ),
    },
  );
  const raw = (await res.json()) as ArchiveResultDTO & {
    error?: ApiErrorBody;
    code?: string;
    message?: string;
  };
  return {
    status: res.status(),
    ok: res.ok(),
    data: res.ok() ? raw : undefined,
    error: raw.error ?? { code: raw.code, message: raw.message },
  };
}

export async function restoreDocument(
  page: Page,
  token: string,
  docId: string,
): Promise<ApiCallResult<ArchiveResultDTO>> {
  const res = await page.request.post(
    `${e2eApiUrl}/api/v1/documents/${docId}/restore`,
    {
      headers: authHeaders(
        token,
        `rest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ),
    },
  );
  const raw = (await res.json()) as ArchiveResultDTO & {
    error?: ApiErrorBody;
    code?: string;
    message?: string;
  };
  return {
    status: res.status(),
    ok: res.ok(),
    data: res.ok() ? raw : undefined,
    error: raw.error ?? { code: raw.code, message: raw.message },
  };
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
  const res = await page.request.get(
    `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents${qs ? `?${qs}` : ""}`,
    { headers: authHeaders(token) },
  );
  expect(
    res.ok(),
    `listDocuments(${qs}) failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  return (await res.json()) as {
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
  const res = await page.request.get(
    `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents/tree${qs ? `?${qs}` : ""}`,
    { headers: authHeaders(token) },
  );
  expect(
    res.ok(),
    `getDocumentTree(${qs}) failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = (await res.json()) as { documents: DocumentTreeNodeDTO[] };
  return body.documents;
}

export async function grantDocumentShare(
  page: Page,
  token: string,
  docId: string,
  principalId: string,
  level: "view" | "edit" | "manage",
): Promise<string> {
  const res = await page.request.post(
    `${e2eApiUrl}/api/v1/documents/${docId}/shares`,
    {
      headers: {
        ...authHeaders(token),
        "content-type": "application/json",
      },
      data: {
        principal_type: "user",
        principal_id: principalId,
        level,
      },
    },
  );
  expect(
    res.ok(),
    `grantDocumentShare failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = (await res.json()) as { share: { id: string } };
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
    `seedDocumentArtifacts getDocument(${docId}): ${docRes.status} ${JSON.stringify(docRes.error)}`,
  ).toBeTruthy();
  const doc = docRes.data!;
  if (doc.kind === "page") {
    // server/internal/service/document_versions.go:67-69: POST /documents/{id}/versions is for page documents only.
    const vRes = await page.request.post(
      `${e2eApiUrl}/api/v1/documents/${docId}/versions`,
      {
        headers: {
          ...authHeaders(
            token,
            `ver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ),
          "content-type": "application/json",
        },
        data: { label: "v-before-move" },
      },
    );
    expect(
      vRes.ok(),
      `seed version: ${vRes.status()} ${await vRes.text()}`,
    ).toBeTruthy();
  } else if (doc.kind === "file") {
    // server/internal/service/document_versions.go:67-69 & server/internal/handler/documents.go:259-320:
    // file documents create version 1 on upload and subsequent versions via /uploads + /versions/commit.
    const meta = FIXTURE_FILES["fx-docx-report-vi"];
    const upRes = await page.request.post(
      `${e2eApiUrl}/api/v1/documents/${docId}/uploads`,
      {
        headers: authHeaders(
          token,
          `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ),
        multipart: {
          file: {
            name: meta.name,
            mimeType: meta.mimeType,
            buffer: readFileSync(meta.path),
          },
        },
      },
    );
    expect(
      upRes.ok(),
      `stage file upload: ${upRes.status()} ${await upRes.text()}`,
    ).toBeTruthy();
    const uploaded = (await upRes.json()) as { upload_id: string };
    const commitRes = await page.request.post(
      `${e2eApiUrl}/api/v1/documents/${docId}/versions/commit`,
      {
        headers: {
          ...authHeaders(
            token,
            `commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ),
          "content-type": "application/json",
        },
        data: {
          upload_id: uploaded.upload_id,
          base_revision: doc.revision,
        },
      },
    );
    expect(
      commitRes.ok(),
      `commit file version: ${commitRes.status()} ${await commitRes.text()}`,
    ).toBeTruthy();
  }
  const cRes = await page.request.post(
    `${e2eApiUrl}/api/v1/documents/${docId}/comments`,
    {
      headers: {
        ...authHeaders(token),
        "content-type": "application/json",
      },
      data: { body: "Ghi chú trước khi chuyển thư mục", kind: "discussion" },
    },
  );
  expect(
    cRes.ok(),
    `seed comment: ${cRes.status()} ${await cRes.text()}`,
  ).toBeTruthy();
  await grantDocumentShare(page, token, docId, shareUserId, "view");
  const afterDoc = await getDocument(page, token, docId);
  expect(
    afterDoc.ok && afterDoc.data,
    `seedDocumentArtifacts refresh(${docId}): ${afterDoc.status} ${JSON.stringify(afterDoc.error)}`,
  ).toBeTruthy();
  return afterDoc.data!;
}

export async function readDocumentArtifacts(
  page: Page,
  token: string,
  docId: string,
): Promise<DocumentArtifactsSnapshot> {
  const [vRes, cRes, sRes] = await Promise.all([
    page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}/versions`, {
      headers: authHeaders(token),
    }),
    page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}/comments`, {
      headers: authHeaders(token),
    }),
    page.request.get(`${e2eApiUrl}/api/v1/documents/${docId}/shares`, {
      headers: authHeaders(token),
    }),
  ]);
  expect(
    vRes.ok(),
    `versions(${docId}): ${vRes.status()} ${await vRes.text()}`,
  ).toBeTruthy();
  expect(
    cRes.ok(),
    `comments(${docId}): ${cRes.status()} ${await cRes.text()}`,
  ).toBeTruthy();
  expect(
    sRes.ok(),
    `shares(${docId}): ${sRes.status()} ${await sRes.text()}`,
  ).toBeTruthy();
  const versions = (await vRes.json()) as {
    versions: Array<{ version: number }>;
  };
  const comments = (await cRes.json()) as { comments: Array<{ id: string }> };
  const shares = (await sRes.json()) as { shares: Array<{ id: string }> };
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
  const res = await page.request.get(
    `${e2eApiUrl}/api/v1/workspaces/${wsId}/documents/sources${qs}`,
    { headers: authHeaders(token) },
  );
  expect(
    res.ok(),
    `listDocumentSources failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = (await res.json()) as { items?: DocumentSourceItemDTO[] };
  return body.items ?? [];
}
