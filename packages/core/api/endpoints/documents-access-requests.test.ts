import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  approveDocumentAccessRequest,
  createDocumentAccessRequest,
  declineDocumentAccessRequest,
  listDocumentAccessRequests,
} from "./documents-access-requests";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// SDO shapes of access addendum §4.3 (W-DOC07, UNI-1631).
const requestRow = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  requester_id: "u2",
  requester_name: "Lan",
  requested_level: "view",
  message: "Mình cần xem để chuẩn bị họp thứ Hai",
  source: { kind: "task", id: "t1", title: "Chuẩn bị họp" },
  created_at: "2026-10-15T03:00:00Z",
  expires_at: "2026-11-14T03:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { status: 7 }, { requests: "x" }, null, [], "str"];

/** The pending rows of d1; a null answer (no such route) fails the test that expects rows. */
async function listedRows() {
  const rows = await listDocumentAccessRequests("d1");
  if (rows === null) throw new Error("expected pending rows, got null");
  return rows;
}

describe("documents-access-requests endpoints", () => {
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

  it("createDocumentAccessRequest POSTs the level, message and source", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "sent" }, 202));
    const out = await createDocumentAccessRequest("d1", {
      requested_level: "edit",
      message: "cần sửa",
      source_kind: "task",
      source_id: "t1",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/access-requests");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      requested_level: "edit",
      message: "cần sửa",
      source_kind: "task",
      source_id: "t1",
    });
    expect(out).toEqual({ status: "sent" });
  });

  it.each(malformedBodies)("createDocumentAccessRequest degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body, 202));
    await expect(createDocumentAccessRequest("d1", { requested_level: "view" })).resolves.toBeNull();
  });

  it("listDocumentAccessRequests reads the pending rows, a source or null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ requests: [requestRow(), requestRow({ id: "r2", source: null, message: "" })] }));
    const out = await listedRows();
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/documents/d1/access-requests");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(requestRow());
    expect(out[1]!.source).toBeNull();
  });

  it("listDocumentAccessRequests drops a malformed row and keeps the rest", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ requests: [requestRow(), { id: 5 }, requestRow({ id: "r3", message: null, source: { kind: 1 } })] }));
    const out = await listedRows();
    expect(out.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(out[1]).toMatchObject({ message: "", source: null });
  });

  it.each(malformedBodies)("listDocumentAccessRequests degrades to an empty list %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listDocumentAccessRequests("d1")).resolves.toEqual([]);
  });

  it("listDocumentAccessRequests resolves null when the server has no such route (404)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "not found" }, 404));
    await expect(listDocumentAccessRequests("d1")).resolves.toBeNull();
  });

  it("listDocumentAccessRequests still rejects a server error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "boom" }, 500));
    await expect(listDocumentAccessRequests("d1")).rejects.toMatchObject({ status: 500 });
  });

  it("approveDocumentAccessRequest POSTs the granted level", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "approved", share_id: "s1" }));
    const out = await approveDocumentAccessRequest("d1", "r1", { level: "view" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/access-requests/r1/approve");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ level: "view" });
    expect(out).toEqual({ id: "r1", status: "approved", share_id: "s1" });
  });

  it("approveDocumentAccessRequest reads a missing share id as empty (already had the level)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "approved" }));
    await expect(approveDocumentAccessRequest("d1", "r1", {})).resolves.toEqual({ id: "r1", status: "approved", share_id: "" });
  });

  it("declineDocumentAccessRequest POSTs to decline", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "declined" }));
    const out = await declineDocumentAccessRequest("d1", "r1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/access-requests/r1/decline");
    expect(init?.method).toBe("POST");
    expect(out).toEqual({ id: "r1", status: "declined", share_id: "" });
  });

  it.each(malformedBodies)("approve and decline degrade %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body)).mockResolvedValueOnce(json(body));
    await expect(approveDocumentAccessRequest("d1", "r1", {})).resolves.toBeNull();
    await expect(declineDocumentAccessRequest("d1", "r1")).resolves.toBeNull();
  });
});
