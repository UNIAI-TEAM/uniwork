import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  archiveDocument,
  getDocumentArchiveImpact,
  getDocumentTree,
  listDocuments,
  listRecentDocuments,
  listSharedWithMe,
  moveDocument,
  restoreDocument,
} from "./documents-collections";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = (over: Record<string, unknown> = {}) => ({
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

const listBody = (over: Record<string, unknown> = {}) => ({
  documents: [summary()],
  next_cursor: null,
  ...over,
});

const treeNode = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  parent_id: null,
  title: "Tài liệu",
  icon: "📄",
  kind: "page",
  position: 0,
  children: [],
  ...over,
});

const malformedBodies = [{ nope: true }, { documents: "x" }, { documents: [{ id: 1 }] }, null, [], "str"];

describe("documents-collections endpoints", () => {
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

  it("listDocuments sends every filter and keeps an empty parent_id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    const out = await listDocuments("w1", {
      parentId: "",
      q: "kế hoạch",
      kind: "page",
      archived: false,
      updatedBy: "u2",
      updatedFrom: "2026-09-01T00:00:00Z",
      cursor: "c1",
      limit: 10,
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/v1/workspaces/w1/documents");
    expect(parsed.searchParams.get("parent_id")).toBe("");
    expect(parsed.searchParams.get("q")).toBe("kế hoạch");
    expect(parsed.searchParams.get("kind")).toBe("page");
    expect(parsed.searchParams.get("archived")).toBe("0");
    expect(parsed.searchParams.get("updated_by")).toBe("u2");
    expect(parsed.searchParams.get("updated_from")).toBe("2026-09-01T00:00:00Z");
    expect(parsed.searchParams.get("cursor")).toBe("c1");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(init?.method ?? "GET").toBe("GET");
    expect(out.documents[0]?.title).toBe("Kế hoạch Q4");
  });

  it("list rows keep admin_scope: true and degrade a non-boolean admin_scope to undefined", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(listBody({ documents: [summary({ my_level: "view", admin_scope: true }), summary({ id: "d2", admin_scope: "yes" })] })),
    );
    const out = await listDocuments("w1");
    expect(out.documents[0]?.admin_scope).toBe(true);
    expect(out.documents[1]?.id).toBe("d2");
    expect(out.documents[1]?.admin_scope).toBeUndefined();
  });

  it("listDocuments omits parent_id when the flat list is wanted", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody({ next_cursor: "n1" })));
    await listDocuments("w1");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents");
  });

  it("listRecentDocuments walks the cursor and the limit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listRecentDocuments("w1", { cursor: "c9", limit: 5 });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/recent?cursor=c9&limit=5");
  });

  it("listSharedWithMe walks the cursor and the limit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody({ documents: [], next_cursor: "n2" })));
    const out = await listSharedWithMe("w1", { cursor: "c9", limit: 5 });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/shared-with-me?cursor=c9&limit=5",
    );
    expect(out.next_cursor).toBe("n2");
  });

  it("listSharedWithMe parses access fields per row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(listBody({ documents: [summary({ my_level: "view", via: "share" })] })),
    );
    const out = await listSharedWithMe("w1");
    expect(out.documents[0]?.my_level).toBe("view");
    expect(out.documents[0]?.via).toBe("share");
  });

  it("getDocumentTree keeps the nested children and encodes the root", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ documents: [treeNode({ children: [treeNode({ id: "d2", parent_id: "d1" })] })] }),
    );
    const out = await getDocumentTree("w1", "d/1");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/tree?root=d%2F1");
    expect(out.documents[0]?.children[0]?.id).toBe("d2");

    vi.mocked(fetch).mockResolvedValueOnce(json({ documents: [treeNode()] }));
    await getDocumentTree("w1");
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/tree",
    );
  });

  it("moveDocument posts the move body with the idempotency header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: summary({ parent_id: "p1", revision: "42" }) }));
    const out = await moveDocument(
      "d1",
      { parent_id: "p1", position: 1.5, revision: "41" },
      { idempotencyKey: "mv-1" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/move");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("mv-1");
    expect(JSON.parse(String(init?.body))).toEqual({ parent_id: "p1", position: 1.5, revision: "41" });
    expect(out?.revision).toBe("42");
  });

  it("archiveDocument and restoreDocument parse the batch answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: summary({ archived_at: "2026-09-28T09:00:00Z" }), batch_id: "b1", affected: ["d1", "d2"] }),
    );
    const archived = await archiveDocument("d1", { idempotencyKey: "ar-1" });
    expect(archived?.batch_id).toBe("b1");
    expect(archived?.affected).toEqual(["d1", "d2"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/archive");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("ar-1");

    vi.mocked(fetch).mockResolvedValueOnce(json({ document: summary(), affected: [] }));
    const restored = await restoreDocument("d1");
    expect(restored?.document.id).toBe("d1");
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/documents/d1/restore");
  });

  // ---- malformed responses: one per endpoint -----------------------------
  // A list that cannot degrade safely throws so its query lands in the error
  // state; a mutation that cannot prove the write resolves null.

  it("listDocuments reads size and origin, and a drifted value as absent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        listBody({
          documents: [
            summary({ id: "f1", kind: "file", size_bytes: 325632, origin: "upload" }),
            summary({ id: "f2", kind: "file", size_bytes: "big", origin: 7 }),
            summary({ id: "p1" }),
          ],
        }),
      ),
    );
    const out = await listDocuments("w1");
    expect(out.documents.map((d) => [d.id, d.size_bytes, d.origin])).toEqual([
      ["f1", 325632, "upload"],
      ["f2", undefined, undefined],
      ["p1", undefined, undefined],
    ]);
  });

  it("list rows carry the viewer's level, and a drifted level reads as absent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        listBody({
          documents: [
            summary({ id: "a", my_level: "manage" }),
            summary({ id: "b", my_level: "view" }),
            summary({ id: "c", my_level: 3 }),
            summary({ id: "d" }),
          ],
        }),
      ),
    );
    const out = await listDocuments("w1");
    expect(out.documents.map((d) => [d.id, d.my_level])).toEqual([
      ["a", "manage"],
      ["b", "view"],
      ["c", undefined],
      ["d", undefined],
    ]);
  });

  it.each(malformedBodies)("listDocuments throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listDocuments("w1")).rejects.toThrow("document_list_invalid");
  });

  it.each(malformedBodies)("listRecentDocuments throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listRecentDocuments("w1")).rejects.toThrow("document_list_invalid");
  });

  it.each(malformedBodies)("listSharedWithMe throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listSharedWithMe("w1")).rejects.toThrow("document_list_invalid");
  });

  it.each(malformedBodies)("getDocumentTree throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentTree("w1")).rejects.toThrow("document_tree_invalid");
  });

  it.each(malformedBodies)("moveDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(moveDocument("d1", { revision: "41" })).resolves.toBeNull();
  });

  it.each(malformedBodies)("archiveDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(archiveDocument("d1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("restoreDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(restoreDocument("d1")).resolves.toBeNull();
  });

  it("a document without revision is not a verifiable move", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: { id: "d1" } }));
    await expect(moveDocument("d1", { revision: "41" })).resolves.toBeNull();
  });

  it("an archive answer without the document is not verifiable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ batch_id: "b1", affected: ["d1"] }));
    await expect(archiveDocument("d1")).resolves.toBeNull();
  });

  // ---- FD-06 (UNI-1466): folders contract v1.0 (addendum §4) -------------

  it("listDocuments sends kind=document and match=title for a title search", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listDocuments("w1", { q: "hop dong", kind: "document", match: "title" });
    const parsed = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(parsed.searchParams.get("kind")).toBe("document");
    expect(parsed.searchParams.get("match")).toBe("title");
    expect(parsed.searchParams.get("q")).toBe("hop dong");
  });

  it("listDocuments leaves match off when the caller does not ask for it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listDocuments("w1", { q: "x" });
    expect(new URL(String(vi.mocked(fetch).mock.calls[0]![0])).searchParams.has("match")).toBe(false);
  });

  it("list rows carry the path from the root, and a missing or drifted path reads as []", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        listBody({
          documents: [
            summary({ id: "a", path: [{ id: "f1", title: "Hợp đồng" }, { id: "f2", title: "2026" }] }),
            summary({ id: "b" }),
            summary({ id: "c", path: "f1/f2" }),
            summary({ id: "d", path: [{ id: 1 }] }),
            summary({ id: "e", path: null }),
          ],
        }),
      ),
    );
    const out = await listDocuments("w1", { q: "x", match: "title" });
    expect(out.documents.map((d) => [d.id, d.path])).toEqual([
      ["a", [{ id: "f1", title: "Hợp đồng" }, { id: "f2", title: "2026" }]],
      ["b", []],
      ["c", []],
      ["d", []],
      ["e", []],
    ]);
  });

  it("a malformed ancestor cuts the path there and keeps the valid prefix", async () => {
    const f1 = { id: "f1", title: "Hợp đồng" };
    const f2 = { id: "f2", title: "2026" };
    const f3 = { id: "f3", title: "Q4" };
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        listBody({
          documents: [
            summary({ id: "a", path: [f1, f2, f3] }),
            summary({ id: "b", path: [f1, { id: 2 }, f3] }),
            summary({ id: "c", path: [{ title: "no id" }, f2] }),
            summary({ id: "d", path: [f1, f2, null] }),
          ],
        }),
      ),
    );
    const out = await listDocuments("w1", { q: "x", match: "title" });
    expect(out.documents.map((d) => [d.id, d.path])).toEqual([
      ["a", [f1, f2, f3]],
      ["b", [f1]],
      ["c", []],
      ["d", [f1, f2]],
    ]);
  });

  it("getDocumentTree asks for folders only when told to", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ documents: [treeNode({ kind: "folder" })] }));
    await getDocumentTree("w1", undefined, undefined, { foldersOnly: true });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/tree?folders_only=true",
    );

    vi.mocked(fetch).mockResolvedValueOnce(json({ documents: [] }));
    await getDocumentTree("w1", "r/1", undefined, { foldersOnly: true });
    const parsed = new URL(String(vi.mocked(fetch).mock.calls[1]![0]));
    expect(parsed.searchParams.get("root")).toBe("r/1");
    expect(parsed.searchParams.get("folders_only")).toBe("true");

    vi.mocked(fetch).mockResolvedValueOnce(json({ documents: [] }));
    await getDocumentTree("w1", undefined, undefined, { foldersOnly: false });
    expect(String(vi.mocked(fetch).mock.calls[2]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/tree",
    );
  });

  it.each(malformedBodies)("getDocumentTree with folders_only throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentTree("w1", undefined, undefined, { foldersOnly: true })).rejects.toThrow(
      "document_tree_invalid",
    );
  });

  it("getDocumentArchiveImpact reads the counts of a subtree under the cap", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ folders: 3, documents: 12, total: 16, max_nodes: 1000, too_large: false }),
    );
    const out = await getDocumentArchiveImpact("d/1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d%2F1/archive-impact");
    expect(init?.method ?? "GET").toBe("GET");
    expect(out).toEqual({ folders: 3, documents: 12, total: 16, max_nodes: 1000, too_large: false });
  });

  it("getDocumentArchiveImpact reads a subtree past the cap without counts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ too_large: true, max_nodes: 1000 }));
    await expect(getDocumentArchiveImpact("d1")).resolves.toEqual({ too_large: true, max_nodes: 1000 });
  });

  it("getDocumentArchiveImpact reads an answer without too_large as under the cap", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ folders: 0, documents: 0, total: 1, max_nodes: 1000 }));
    await expect(getDocumentArchiveImpact("d1")).resolves.toEqual({
      folders: 0,
      documents: 0,
      total: 1,
      max_nodes: 1000,
      too_large: false,
    });
  });

  // An impact that cannot be read never turns into counts: a missing count,
  // a negative or fractional one, or no cap degrades to null (never a throw),
  // and the hook turns null into "result not verifiable".
  it.each([
    ...malformedBodies,
    {},
    { folders: 1, documents: 2, max_nodes: 1000, too_large: false },
    { folders: -1, documents: 2, total: 4, max_nodes: 1000, too_large: false },
    { folders: 1.5, documents: 2, total: 4, max_nodes: 1000, too_large: false },
    { folders: "1", documents: 2, total: 4, max_nodes: 1000, too_large: false },
    { folders: 1, documents: 2, total: 4, too_large: false },
    { too_large: true },
    { too_large: "yes", max_nodes: 1000 },
  ])("getDocumentArchiveImpact degrades to null %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentArchiveImpact("d1")).resolves.toBeNull();
  });
});
