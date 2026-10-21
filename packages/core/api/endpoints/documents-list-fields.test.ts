import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { listDocuments, listFavoriteDocuments, listRecentDocuments, listSharedByMe, listSharedWithMe } from "./documents-collections";

// The optional list fields of UNI-2045 (SV-1..SV-6) and the workspace
// favorites list (SV-2). Every field is new: a server that does not send it,
// or sends it drifted, leaves the row as it was.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Báo cáo.docx",
  visibility: "restricted",
  revision: "4",
  current_version: 2,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u2",
  updated_by_kind: "human",
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-20T09:00:00Z",
  ...over,
});

const listBody = (rows: unknown[], next: string | null = null) => ({ documents: rows, next_cursor: next });

const malformedBodies = [{ nope: true }, { documents: "x" }, { documents: [{ id: 1 }] }, null, [], "str", { favorites: [] }];

describe("UNI-2045 list fields", () => {
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

  it("reads last_activity, is_owner and updated_by_user on a recent row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        listBody([
          summary({
            last_activity: { kind: "edited", at: "2026-10-20T09:00:00Z" },
            is_owner: true,
            updated_by_user: { name: "Nguyễn Văn An", avatar_url: "https://cdn.test/an.png" },
          }),
        ]),
      ),
    );
    const [row] = (await listRecentDocuments("w1")).documents;
    expect(row?.last_activity).toEqual({ kind: "edited", at: "2026-10-20T09:00:00Z" });
    expect(row?.is_owner).toBe(true);
    expect(row?.updated_by_user).toEqual({ name: "Nguyễn Văn An", avatar_url: "https://cdn.test/an.png" });
  });

  it("keeps an unknown activity kind as a string and an editor without a photo", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(listBody([summary({ last_activity: { kind: "printed", at: "2026-10-20T09:00:00Z" }, updated_by_user: { name: "An" } })])),
    );
    const [row] = (await listRecentDocuments("w1")).documents;
    expect(row?.last_activity?.kind).toBe("printed");
    expect(row?.updated_by_user).toEqual({ name: "An" });
  });

  it("reads shared on a shared-with-me row, by_name null included", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        listBody([
          summary({ id: "a", shared: { by: "u3", by_kind: "human", by_name: "Trần Thị Bình", at: "2026-10-19T09:30:00Z" } }),
          summary({ id: "b", shared: { by: "u9", by_kind: "human", by_name: null, at: "2026-10-19T09:30:00Z" } }),
        ]),
      ),
    );
    const [named, unnamed] = (await listSharedWithMe("w1")).documents;
    expect(named?.shared).toEqual({ by: "u3", by_kind: "human", by_name: "Trần Thị Bình", at: "2026-10-19T09:30:00Z" });
    expect(unnamed?.shared?.by_name).toBeNull();
  });

  it("reads share_summary on a shared-by-me row, latest_at null included", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        listBody([
          summary({ id: "a", share_summary: { people: 3, workspaces: 1, links: 0, latest_at: "2026-10-19T09:30:00Z" } }),
          summary({ id: "b", share_summary: { people: 0, workspaces: 0, links: 0, latest_at: null } }),
        ]),
      ),
    );
    const [a, b] = (await listSharedByMe("w1")).documents;
    expect(a?.share_summary).toEqual({ people: 3, workspaces: 1, links: 0, latest_at: "2026-10-19T09:30:00Z" });
    expect(b?.share_summary?.latest_at).toBeNull();
  });

  it("reads a row without any of the new fields as today (absent, never invented)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody([summary()])));
    const [row] = (await listDocuments("w1")).documents;
    expect(row).toBeDefined();
    for (const key of ["last_activity", "favorited_at", "shared", "share_summary", "is_owner", "updated_by_user"] as const) {
      expect(row?.[key]).toBeUndefined();
    }
  });

  it("degrades each drifted field to absent and keeps the row", async () => {
    const drifted = [
      { last_activity: { kind: 1, at: "2026-10-20T09:00:00Z" } },
      { last_activity: "edited" },
      { last_activity: null },
      { favorited_at: 42 },
      { shared: { by: 7, at: "2026-10-19T09:30:00Z" } },
      { shared: { by: "u3", by_kind: "human", by_name: "B" } },
      { shared: "u3" },
      { share_summary: { people: "3", workspaces: 1, links: 1, latest_at: null } },
      { share_summary: { people: -1, workspaces: 1, links: 1, latest_at: null } },
      { share_summary: [] },
      { is_owner: "yes" },
      { updated_by_user: { avatar_url: "https://cdn.test/x.png" } },
      { updated_by_user: "An" },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody(drifted.map((over, i) => summary({ id: `d${i}`, ...over })))));
    const rows = (await listDocuments("w1")).documents;
    expect(rows).toHaveLength(drifted.length);
    for (const row of rows) {
      expect(row.last_activity ?? undefined).toBeUndefined();
      expect(row.favorited_at ?? undefined).toBeUndefined();
      expect(row.shared ?? undefined).toBeUndefined();
      expect(row.share_summary ?? undefined).toBeUndefined();
      expect(row.is_owner).toBeUndefined();
      expect(row.updated_by_user ?? undefined).toBeUndefined();
    }
  });

  it("keeps an explicit updated_by_user null (editor outside the organization)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody([summary({ updated_by_user: null })])));
    const [row] = (await listDocuments("w1")).documents;
    expect(row?.updated_by_user).toBeNull();
  });
});

describe("listFavoriteDocuments (SV-2)", () => {
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

  it("reads one page of the workspace's starred rows with favorited_at and the cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody([summary({ favorited_at: "2026-10-20T08:00:00Z" })], "c2")));
    const page = await listFavoriteDocuments("w 1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/w%201/documents/favorites");
    expect(page.next_cursor).toBe("c2");
    expect(page.documents[0]?.favorited_at).toBe("2026-10-20T08:00:00Z");
    expect(page.documents[0]?.title).toBe("Báo cáo.docx");
  });

  it("sends only the cursor and the page size", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody([])));
    await listFavoriteDocuments("w1", { cursor: "c2", limit: 50 });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/w1/documents/favorites?cursor=c2&limit=50");
  });

  it.each(malformedBodies)("throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listFavoriteDocuments("w1")).rejects.toThrow("document_list_invalid");
  });
});
