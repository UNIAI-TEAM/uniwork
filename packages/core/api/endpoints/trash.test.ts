import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { listTrash } from "./trash";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const item = {
  kind: "document",
  id: "d1",
  title: "Hợp đồng",
  identifier: "",
  sub_kind: "docx",
  count: 3,
  location_title: "Pháp lý",
  location_path: ["Tài liệu", "Pháp lý"],
  trashed_by: "u1",
  trashed_at: "2026-10-26T00:00:00Z",
  purge_after: "2026-11-25T00:00:00Z",
  can_manage: true,
};

describe("listTrash", () => {
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

  it("omits empty filters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [], next_cursor: "" }));
    await listTrash("ws 1", { q: "", trashedBy: "" });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/ws%201/trash");
  });

  it("sends every filter and the cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [item], next_cursor: "c2" }));
    const page = await listTrash("ws1", { kind: "document", q: "hợp", trashedBy: "u1", cursor: "c1" });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/workspaces/ws1/trash");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "document",
      q: "hợp",
      trashed_by: "u1",
      cursor: "c1",
    });
    expect(page.items[0]).toMatchObject({ id: "d1", location_path: ["Tài liệu", "Pháp lý"], can_manage: true });
    expect(page.next_cursor).toBe("c2");
  });

  it("answers null for the last page's empty cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [item], next_cursor: "" }));
    expect((await listTrash("ws1")).next_cursor).toBeNull();
  });

  it("degrades a malformed body to an empty page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: "nope" }));
    expect(await listTrash("ws1")).toEqual({ items: [], next_cursor: null });
  });
});
