import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { DocumentAccessSchema } from "../../types/document";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import {
  canBreakGlassFromError,
  createDocument,
  createDocumentBreakGlass,
  createDocumentComment,
  createDocumentFile,
  documentAssetPath,
  documentDownloadPath,
  downloadDocumentFile,
  getDocument,
  getDocumentAdminSummary,
  getDocumentAsset,
  getDocumentDownloadMeta,
  isBreakGlassReasonInvalidError,
  isBreakGlassRequiredError,
  isDocumentRestrictedError,
  listDocumentMentionCandidates,
  parseDocumentAccessError,
  patchDocument,
  revokeDocumentBreakGlass,
  updateDocumentComment,
  uploadDocumentAsset,
  uploadDocumentFile,
} from "./documents";
import {
  commitDocumentVersion,
  createDocumentVersion,
  getDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
} from "./documents-versions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "page",
  title: "Kế hoạch Q4",
  visibility: "workspace",
  revision: "41",
  current_version: 3,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
  ...over,
});

const versionBody = (over: Record<string, unknown> = {}) => ({
  id: "v1",
  document_id: "d1",
  version: 2,
  kind: "page",
  reason: "manual",
  size_bytes: 812,
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-27T10:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { document: "x" }, null, [], "str"];

describe("documents endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  // ---- wire shape -------------------------------------------------------

  it("createDocument posts snake_case fields with the idempotency header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }));
    const out = await createDocument(
      "w1",
      { title: "Kế hoạch Q4", kind: "page", parent_id: "p1", content: { type: "doc" } },
      { idempotencyKey: "key-1" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("key-1");
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "Kế hoạch Q4",
      kind: "page",
      parent_id: "p1",
      content: { type: "doc" },
    });
    expect(out?.id).toBe("d1");
    expect(out?.revision).toBe("41");
  });

  it("patchDocument sends the base revision as a string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ revision: "42" }) }));
    const out = await patchDocument("d1", { revision: "41", title: "t" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ revision: "41", title: "t" });
    expect(out?.revision).toBe("42");
  });

  it("createDocumentFile posts multipart form data, not JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ kind: "file" }) }));
    const file = new Blob(["bytes"], { type: "application/pdf" });
    const out = await createDocumentFile("w1", file, { parent_id: "p1", title: "Báo cáo" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/files");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("parent_id")).toBe("p1");
    expect(form.get("title")).toBe("Báo cáo");
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull();
    expect(out?.kind).toBe("file");
  });

  it("uploadDocumentFile posts the file part only", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        upload_id: "f1",
        checksum_sha256: "abc",
        size_bytes: 5,
        claim_expires_at: "2026-09-28T09:00:00Z",
      }),
    );
    const out = await uploadDocumentFile("d1", new Blob(["bytes"]));
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/uploads");
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(out?.upload_id).toBe("f1");
  });

  it("uploadDocumentFile names a bare Blob's part from opts.filename", async () => {
    // FileService decides a text document's type from the verified bytes plus
    // the part's `.md` extension; an unnamed part sniffs as text/plain, and
    // the commit then refuses the version with 415 format_changed.
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        upload_id: "f1",
        checksum_sha256: "abc",
        size_bytes: 4,
        claim_expires_at: "2026-09-28T09:00:00Z",
      }),
    );
    await uploadDocumentFile("d1", new Blob(["# hi"], { type: "text/markdown" }), {
      filename: "document.md",
    });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const part = (init?.body as FormData).get("file") as File;
    expect(part).toBeInstanceOf(File);
    expect(part.name).toBe("document.md");
    // The part's own type still travels; the name is what lets the server's
    // extension-based sniff reach text/markdown.
    expect(part.type).toBe("text/markdown");
  });

  it("createDocumentFile keeps a named File's own name", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ kind: "file" }) }));
    await createDocumentFile("w1", new File(["bytes"], "brief.docx"));
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const part = (init?.body as FormData).get("file") as File;
    expect(part.name).toBe("brief.docx");
  });

  it("createDocumentFile orders text fields before the file part while keeping the filename", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ kind: "file" }) }));
    await createDocumentFile("w1", new File(["bytes"], "brief.docx"), {
      parent_id: "p1",
      title: "Báo cáo",
    });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const form = init?.body as FormData;
    expect(Array.from(form.keys())).toEqual(["parent_id", "title", "file"]);
    expect((form.get("file") as File).name).toBe("brief.docx");
  });

  it("commitDocumentVersion sends upload_id + base_revision with the key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: docBody({ revision: "42" }), version: versionBody() }),
    );
    const out = await commitDocumentVersion(
      "d1",
      { upload_id: "f1", base_revision: "41" },
      { idempotencyKey: "key-9" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/versions/commit");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("key-9");
    expect(JSON.parse(String(init?.body))).toEqual({ upload_id: "f1", base_revision: "41" });
    expect(out?.document.revision).toBe("42");
    expect(out?.version.version).toBe(2);
  });

  it("listDocumentVersions maps next_cursor and joins pages by key prefix", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ versions: [versionBody()], next_cursor: "abc" }),
    );
    const out = await listDocumentVersions("d1", { cursor: "c0", limit: 50 });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/versions?cursor=c0&limit=50");
    expect(out.nextCursor).toBe("abc");
    expect(out.versions).toHaveLength(1);
  });

  it("restoreDocumentVersion posts to the version-scoped route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: docBody({ revision: "43" }), version: versionBody({ reason: "restore" }) }),
    );
    const out = await restoreDocumentVersion("d1", 1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/versions/1/restore");
    expect(init?.method).toBe("POST");
    expect(out?.version.reason).toBe("restore");
    // A page restore sends no body; a file restore carries the base revision.
    expect(init?.body).toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: docBody({ revision: "44" }), version: versionBody({ reason: "restore" }) }),
    );
    await restoreDocumentVersion("d1", 1, { baseRevision: "43" });
    const [, initWithBase] = vi.mocked(fetch).mock.calls[1]!;
    expect(JSON.parse(String(initWithBase?.body))).toEqual({ base_revision: "43" });
  });

  it("getDocumentDownloadMeta requests meta=1 and keeps version", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        document_id: "d1",
        file: {
          file_id: "f2",
          version_id: "v2",
          version: 2,
          filename: "bao-cao.pdf",
          mime_type: "application/pdf",
          size_bytes: 250112,
          checksum_sha256: "abc",
        },
        disposition: "attachment",
      }),
    );
    const out = await getDocumentDownloadMeta("d1", 2);
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/download?version=2&meta=1");
    expect(out?.file.file_id).toBe("f2");
    expect(out?.disposition).toBe("attachment");
  });

  it("documentAssetPath and documentDownloadPath build the proxy routes", () => {
    expect(documentAssetPath("d1", "a1")).toBe("/api/v1/documents/d1/assets/a1");
    expect(documentDownloadPath("d1")).toBe("/api/v1/documents/d1/download");
    expect(documentDownloadPath("d1", 2)).toBe("/api/v1/documents/d1/download?version=2");
  });

  it("downloadDocumentFile and getDocumentAsset return blobs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const blob = await downloadDocumentFile("d1", 2);
    expect(blob.size).toBe(3);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([9])));
    const asset = await getDocumentAsset("d1", "a1");
    expect(asset.size).toBe(1);
  });

  // ---- malformed responses: one per endpoint -----------------------------
  // A mutation answer that cannot prove the write resolves null; the hook /
  // save machine turns it into "result not verifiable" and keeps dirty state.
  // Lists that cannot degrade safely throw so the query lands in error state.

  it.each(malformedBodies)("getDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocument("d1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("createDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(createDocument("w1", { title: "t" })).resolves.toBeNull();
  });

  it.each(malformedBodies)("patchDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(patchDocument("d1", { revision: "41" })).resolves.toBeNull();
  });

  it.each(malformedBodies)("createDocumentFile degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(createDocumentFile("w1", new Blob(["x"]))).resolves.toBeNull();
  });

  it.each(malformedBodies)("uploadDocumentFile degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(uploadDocumentFile("d1", new Blob(["x"]))).resolves.toBeNull();
  });

  it.each(malformedBodies)("uploadDocumentAsset degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(uploadDocumentAsset("d1", new Blob(["x"]))).resolves.toBeNull();
  });

  it.each(malformedBodies)("getDocumentDownloadMeta degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentDownloadMeta("d1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("listDocumentVersions throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listDocumentVersions("d1")).rejects.toThrow("document_versions_invalid");
  });

  it.each(malformedBodies)("getDocumentVersion degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentVersion("d1", 2)).resolves.toBeNull();
  });

  it.each(malformedBodies)("createDocumentVersion degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(createDocumentVersion("d1", { label: "v" })).resolves.toBeNull();
  });

  it.each(malformedBodies)("commitDocumentVersion degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(
      commitDocumentVersion("d1", { upload_id: "f1", base_revision: "41" }),
    ).resolves.toBeNull();
  });

  it.each(malformedBodies)("restoreDocumentVersion degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(restoreDocumentVersion("d1", 1)).resolves.toBeNull();
  });

  it("a document without revision is not a verifiable write", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: { id: "d1" } }));
    await expect(patchDocument("d1", { revision: "41" })).resolves.toBeNull();
  });

  it("a commit result without the version row is not verifiable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }));
    await expect(
      commitDocumentVersion("d1", { upload_id: "f1", base_revision: "41" }),
    ).resolves.toBeNull();
  });

  it("blob endpoints throw the server error, never a fake blob", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "forbidden", message: "no" } }, 403),
    );
    await expect(downloadDocumentFile("d1")).rejects.toMatchObject({
      name: "ApiError",
      code: "forbidden",
      status: 403,
    });
  });

  it("keeps lenient enum parsing: unknown reason/kind still parse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ versions: [versionBody({ reason: "future_reason" })], next_cursor: null }),
    );
    const out = await listDocumentVersions("d1");
    expect(out.versions[0]?.reason).toBe("future_reason");
  });

  // ---- G8-18: mentions_without_access + mention-candidates can_view ------

  it("createDocumentComment and updateDocumentComment parse mentions_without_access", async () => {
    const commentWithMentions = {
      id: "c1",
      document_id: "d1",
      author_id: "u1",
      author_kind: "human",
      body: "Xem giúp [@Bình](mention://member/u2) và [@Chi](mention://member/u3)",
      type: "discussion",
      kind: "discussion",
      revision: 1,
      created_at: "2026-10-15T01:00:00Z",
      updated_at: "2026-10-15T01:00:00Z",
      mentions_without_access: [
        { user_id: "u2", display_name: "Trần Bình", can_share: true },
        { user_id: "u3", can_share: false },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(json({ comment: commentWithMentions }, 201));
    const created = await createDocumentComment(
      "d1",
      { body: commentWithMentions.body },
      { idempotencyKey: "k-c1" },
    );
    expect(created?.id).toBe("c1");
    expect(created?.mentions_without_access).toEqual([
      { user_id: "u2", display_name: "Trần Bình", can_share: true },
      { user_id: "u3", can_share: false },
    ]);

    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        comment: {
          ...commentWithMentions,
          revision: 2,
          mentions_without_access: [{ user_id: "u2", display_name: "Trần Bình", can_share: false }],
        },
      }),
    );
    const updated = await updateDocumentComment("d1", "c1", { body: "Cập nhật" });
    expect(updated?.revision).toBe(2);
    expect(updated?.mentions_without_access).toEqual([
      { user_id: "u2", display_name: "Trần Bình", can_share: false },
    ]);
  });

  it("degrades malformed mentions_without_access without dropping the comment", async () => {
    const baseComment = {
      id: "c1",
      document_id: "d1",
      body: "Nội dung bình luận",
      revision: 1,
    };

    // Non-array mentions_without_access degrades to [] while preserving the comment.
    for (const badField of ["not-an-array", 42, { user_id: "u2" }, true]) {
      vi.mocked(fetch).mockResolvedValueOnce(
        json({ comment: { ...baseComment, mentions_without_access: badField } }),
      );
      const out = await createDocumentComment("d1", { body: "Nội dung bình luận" });
      expect(out?.id).toBe("c1");
      expect(out?.mentions_without_access).toEqual([]);
    }

    // Malformed items inside mentions_without_access are dropped; valid items and
    // items with a non-string display_name degrade gracefully.
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        comment: {
          ...baseComment,
          mentions_without_access: [
            { nope: true },
            { user_id: "", can_share: true },
            { user_id: "u2", can_share: "yes" },
            { user_id: "u3", display_name: 12345, can_share: true },
            { user_id: "u4", display_name: "Lê Dung", can_share: false },
          ],
        },
      }),
    );
    const partial = await updateDocumentComment("d1", "c1", { body: "Nội dung bình luận" });
    expect(partial?.id).toBe("c1");
    expect(partial?.mentions_without_access).toEqual([
      { user_id: "u3", can_share: true },
      { user_id: "u4", display_name: "Lê Dung", can_share: false },
    ]);
  });

  it("listDocumentMentionCandidates sends include=no_access and parses can_view", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        candidates: [
          { user_id: "u1", display_name: "Nguyễn An", can_view: true },
          { user_id: "u2", display_name: "Trần Bình", can_view: false },
          { user_id: "u3", display_name: "Lê Chi" },
        ],
      }),
    );
    const out = await listDocumentMentionCandidates("d1", {
      q: "  an ",
      limit: 15,
      include: "no_access",
    });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(
      "http://api.test/api/v1/documents/d1/mention-candidates?q=an&limit=15&include=no_access",
    );
    expect(out).toEqual([
      { user_id: "u1", display_name: "Nguyễn An", can_view: true },
      { user_id: "u2", display_name: "Trần Bình", can_view: false },
      { user_id: "u3", display_name: "Lê Chi", can_view: undefined },
    ]);
  });

  it("degrades malformed can_view and malformed mention candidate rows safely", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        candidates: [
          { user_id: "u1", display_name: "An", can_view: "not-a-bool" },
          { user_id: "", display_name: "Empty id", can_view: false },
          { nope: true },
          null,
          { user_id: "u2", display_name: null, can_view: false },
        ],
      }),
    );
    const out = await listDocumentMentionCandidates("d1", { includeNoAccess: true });
    expect(out).toEqual([
      { user_id: "u1", display_name: "An", can_view: undefined },
      { user_id: "u2", display_name: "", can_view: false },
    ]);

    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(
        listDocumentMentionCandidates("d1", { include: "no_access" }),
      ).resolves.toEqual([]);
    }
  });

  // ---- DOC-05: break-glass + admin-summary + typed errors ----------------

  const grantBody = (over: Record<string, unknown> = {}) => ({
    id: "bg1",
    document_id: "d1",
    actor_id: "u_admin",
    actor_name: "Nguyễn Quản Trị",
    level: "view",
    reason: "Kiểm tra sự cố bảo mật theo yêu cầu của trưởng bộ phận",
    granted_at: "2026-10-15T02:00:00Z",
    expires_at: "2026-10-16T02:00:00Z",
    ...over,
  });

  it("createDocumentBreakGlass posts reason and parses the grant envelope", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ grant: grantBody() }, 201));
    const grant = await createDocumentBreakGlass(
      "d1",
      { reason: "Kiểm tra sự cố bảo mật theo yêu cầu của trưởng bộ phận" },
      { idempotencyKey: "bg-key-1" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/break-glass");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("bg-key-1");
    expect(JSON.parse(String(init?.body))).toEqual({
      reason: "Kiểm tra sự cố bảo mật theo yêu cầu của trưởng bộ phận",
    });
    expect(grant).toMatchObject({
      id: "bg1",
      document_id: "d1",
      actor_id: "u_admin",
      actor_name: "Nguyễn Quản Trị",
      level: "view",
      expires_at: "2026-10-16T02:00:00Z",
    });
  });

  it.each([
    ...malformedBodies,
    { grant: null },
    { grant: { id: "bg1" } },
    { grant: grantBody({ expires_at: "" }) },
  ])("createDocumentBreakGlass degrades malformed response %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(
      createDocumentBreakGlass("d1", { reason: "Lý do hợp lệ trên mười ký tự" }),
    ).resolves.toBeNull();
  });

  it("revokeDocumentBreakGlass sends DELETE and verifies { status: 'ok' }", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const ok = await revokeDocumentBreakGlass("d1", "bg1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/break-glass/bg1");
    expect(init?.method).toBe("DELETE");
    expect(ok).toBe(true);

    for (const body of [...malformedBodies, { status: "failed" }]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(revokeDocumentBreakGlass("d1", "bg1")).resolves.toBe(false);
    }
  });

  it("getDocumentAdminSummary reads metadata, acl_owner, and my_grant", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        document: {
          id: "d1",
          organization_id: "o1",
          workspace_id: "w1",
          parent_id: null,
          kind: "page",
          title: "Biên bản họp kín",
          visibility: "restricted",
          size_bytes: 0,
          created_by: "u_owner",
          created_at: "2026-10-14T09:00:00Z",
          updated_at: "2026-10-15T01:00:00Z",
        },
        acl_owner: { user_id: "u_owner", level: "manage", via: "owner" },
        my_level: "view",
        via: "break_glass",
        admin_scope: true,
        my_grant: grantBody(),
      }),
    );
    const summary = await getDocumentAdminSummary("d1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/admin-summary");
    expect(init?.method).toBe("GET");
    expect(summary?.document.title).toBe("Biên bản họp kín");
    expect(summary?.acl_owner).toEqual({ user_id: "u_owner", level: "manage", via: "owner" });
    expect(summary?.my_level).toBe("view");
    expect(summary?.via).toBe("break_glass");
    expect(summary?.my_grant?.id).toBe("bg1");
  });

  it("getDocumentAdminSummary tolerates malformed my_grant/acl_owner and rejects missing document", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        document: {
          id: "d1",
          workspace_id: "w1",
          kind: "page",
          title: "Tài liệu hạn chế",
          visibility: "restricted",
        },
        acl_owner: { nope: true },
        my_level: "",
        my_grant: { id: "broken-grant-without-timestamps" },
      }),
    );
    const degraded = await getDocumentAdminSummary("d1");
    expect(degraded?.document.id).toBe("d1");
    expect(degraded?.acl_owner).toBeNull();
    expect(degraded?.my_level).toBe("");
    expect(degraded?.my_grant).toBeNull();

    for (const body of [...malformedBodies, { document: { id: "d1" } }]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(getDocumentAdminSummary("d1")).resolves.toBeNull();
    }
  });

  it("DocumentSchema parses break_glass_expires_at and DocumentAccessSchema tolerates malformed break_glass items", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        document: docBody({
          my_level: "view",
          via: "break_glass",
          break_glass_expires_at: "2026-10-16T02:00:00Z",
        }),
      }),
    );
    const doc = await getDocument("d1");
    expect(doc?.via).toBe("break_glass");
    expect(doc?.break_glass_expires_at).toBe("2026-10-16T02:00:00Z");

    const parsedAccess = DocumentAccessSchema.parse({
      my_level: "",
      via: "",
      break_glass: [grantBody(), { id: "incomplete" }, "bad"],
    });
    expect(parsedAccess.my_level).toBe("");
    expect(parsedAccess.break_glass).toHaveLength(1);
    expect(parsedAccess.break_glass?.[0]?.id).toBe("bg1");

    const nonArrayBreakGlass = DocumentAccessSchema.parse({
      my_level: "manage",
      break_glass: "not-an-array",
    });
    expect(nonArrayBreakGlass.break_glass).toEqual([]);
  });

  it("parses document_restricted, break_glass_required, and break_glass_reason_invalid typed errors", () => {
    const restrictedCanBreakGlass = new ApiError(
      "restricted",
      "document_restricted",
      403,
      "corr-1",
      { can_break_glass: true },
      "permission",
    );
    expect(parseDocumentAccessError(restrictedCanBreakGlass)).toEqual({
      kind: "document_restricted",
      code: "document_restricted",
      canBreakGlass: true,
      can_break_glass: true,
      status: 403,
      message: "restricted",
    });
    expect(isDocumentRestrictedError(restrictedCanBreakGlass)).toBe(true);
    expect(canBreakGlassFromError(restrictedCanBreakGlass)).toBe(true);

    // Malformed can_break_glass (non-boolean or missing fields) safely degrades to false.
    const restrictedMalformed = new ApiError(
      "restricted",
      "document_restricted",
      403,
      "corr-2",
      { can_break_glass: "true" },
      "permission",
    );
    expect(parseDocumentAccessError(restrictedMalformed)?.canBreakGlass).toBe(false);
    expect(canBreakGlassFromError(restrictedMalformed)).toBe(false);

    const selfShareRefused = new ApiError(
      "use break-glass",
      "break_glass_required",
      403,
      "corr-3",
      undefined,
      "permission",
    );
    expect(parseDocumentAccessError(selfShareRefused)).toEqual({
      kind: "break_glass_required",
      code: "break_glass_required",
      status: 403,
      message: "use break-glass",
    });
    expect(isBreakGlassRequiredError(selfShareRefused)).toBe(true);

    const invalidReason = new ApiError(
      "reason too short",
      "break_glass_reason_invalid",
      422,
      "corr-4",
      { min: 10, max: 500, length: 4 },
    );
    expect(parseDocumentAccessError(invalidReason)).toEqual({
      kind: "break_glass_reason_invalid",
      code: "break_glass_reason_invalid",
      min: 10,
      max: 500,
      length: 4,
      status: 422,
      message: "reason too short",
    });
    expect(isBreakGlassReasonInvalidError(invalidReason)).toBe(true);

    // Unrelated error or non-error returns null.
    expect(parseDocumentAccessError(new ApiError("no", "forbidden", 403))).toBeNull();
    expect(parseDocumentAccessError(null)).toBeNull();
    expect(parseDocumentAccessError("nope")).toBeNull();
  });
});
