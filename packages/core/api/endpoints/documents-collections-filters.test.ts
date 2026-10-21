import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  listDocuments,
  listRecentDocuments,
  listSharedByMe,
  listSharedWithMe,
  listShelvedDocuments,
  listTrashedDocuments,
} from "./documents-collections";

// UNI-2045 W10: one filter bar on every list screen. The server agreed SV-7
// (`format=txt` everywhere), SV-8 (`updated_by`, `updated_from/to` on recent,
// shared-with-me, shared_by_me, archived and shelved, as on the flat list) and
// SV-1b (`activity=opened|edited` on recent); W11 asks Recent and Shared with
// me for their own order (`sort=activity` / `sort=shared`) while grouped.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const listBody = () => ({
  documents: [{ id: "d1", workspace_id: "w1", kind: "file", title: "Ghi chú.txt", revision: "1", format: "txt", updated_at: "2026-10-20T09:00:00Z" }],
  next_cursor: null,
});

const malformedBodies = [{ nope: true }, { documents: "x" }, { documents: [{ id: 1 }] }, null, [], "str"];

const WINDOW = { updatedBy: "u2", updatedFrom: "2026-10-01T00:00:00.000Z", updatedTo: "2026-10-21T00:00:00.000Z" } as const;

const params = (call: number) => new URL(String(vi.mocked(fetch).mock.calls[call]![0])).searchParams;

describe("documents-collections filters (UNI-2045 W10)", () => {
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

  it("sends format=txt on every list that takes a format, and reads the row's txt format back", async () => {
    const calls = [
      () => listDocuments("w1", { parentId: "", format: "txt" }),
      () => listRecentDocuments("w1", { format: "txt" }),
      () => listSharedWithMe("w1", { format: "txt" }),
      () => listSharedByMe("w1", { format: "txt" }),
      () => listShelvedDocuments("w1", { format: "txt" }),
      () => listTrashedDocuments("w1", { format: "txt" }),
    ];
    for (const [index, call] of calls.entries()) {
      vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
      const out = await call();
      expect(params(index).get("format")).toBe("txt");
      expect(out.documents[0]?.format).toBe("txt");
    }
  });

  it("sends updated_by and the updated window on recent, shared-with-me, shared_by_me, shelved and archived", async () => {
    const calls = [
      () => listRecentDocuments("w1", { ...WINDOW }),
      () => listSharedWithMe("w1", { ...WINDOW }),
      () => listSharedByMe("w1", { ...WINDOW }),
      () => listShelvedDocuments("w1", { ...WINDOW }),
      () => listTrashedDocuments("w1", { ...WINDOW }),
    ];
    for (const [index, call] of calls.entries()) {
      vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
      await call();
      const query = params(index);
      expect(query.get("updated_by")).toBe("u2");
      expect(query.get("updated_from")).toBe("2026-10-01T00:00:00.000Z");
      expect(query.get("updated_to")).toBe("2026-10-21T00:00:00.000Z");
    }
    // The fixed parts of each route stay as they were.
    expect(params(2).get("shared_by_me")).toBe("true");
    expect(params(3).get("shelved")).toBe("true");
    expect(params(4).get("archived")).toBe("1");
    expect(params(4).get("sort")).toBe("deleted");
  });

  it("leaves every new parameter off when the caller names none, so an unfiltered request is unchanged", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listRecentDocuments("w1", { limit: 5 });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/w1/documents/recent?limit=5");
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listShelvedDocuments("w1", { limit: 5 });
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/workspaces/w1/documents?shelved=true&limit=5");
  });

  it("sends activity=opened|edited on recent only when asked", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listRecentDocuments("w1", { activity: "opened" });
    expect(params(0).get("activity")).toBe("opened");
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listRecentDocuments("w1", { activity: "edited", format: "docx" });
    expect(params(1).get("activity")).toBe("edited");
    expect(params(1).get("format")).toBe("docx");
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listRecentDocuments("w1", {});
    expect(params(2).has("activity")).toBe(false);
  });

  it("asks Recent for sort=activity and Shared with me for sort=shared (W11 groups)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listRecentDocuments("w1", { sort: "activity", order: "desc" });
    expect(params(0).get("sort")).toBe("activity");
    expect(params(0).get("order")).toBe("desc");
    vi.mocked(fetch).mockResolvedValueOnce(json(listBody()));
    await listSharedWithMe("w1", { sort: "shared", order: "desc" });
    expect(params(1).get("sort")).toBe("shared");
  });

  it.each(malformedBodies)("a filtered list that answers malformed still throws rather than fake-empty %#", async (body) => {
    for (const call of [
      () => listRecentDocuments("w1", { activity: "edited", ...WINDOW }),
      () => listSharedWithMe("w1", { format: "txt", ...WINDOW }),
      () => listSharedByMe("w1", { ...WINDOW }),
      () => listShelvedDocuments("w1", { ...WINDOW }),
      () => listTrashedDocuments("w1", { ...WINDOW }),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(call()).rejects.toThrow("document_list_invalid");
    }
  });
});
