import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  archiveDocument,
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
});
