import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  createDocumentLink,
  getDocumentShares,
  listDocumentAccessLogs,
  revokeDocumentLink,
  revokeDocumentShare,
  setDocumentPublicLinks,
  shareDocument,
} from "./documents-sharing";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const share = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  principal_type: "user",
  principal_id: "u2",
  level: "view",
  active: true,
  granted_by: "u1",
  granted_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  ...over,
});

const link = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  expires_at: "2026-10-04T09:00:00Z",
  view_count: 0,
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  ...over,
});

const accessBody = (over: Record<string, unknown> = {}) => ({
  my_level: "manage",
  via: "member",
  acl_owner: { user_id: "u1", level: "manage", via: "member" },
  shares: [share()],
  links: [link()],
  ...over,
});

const logRow = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  action: "view",
  via: "share",
  actor_kind: "human",
  actor_id: "u2",
  actor: { id: "u2", kind: "human", display_name: "B" },
  occurred_at: "2026-09-27T09:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { share: "x" }, { logs: "x" }, null, [], "str"];

describe("documents-sharing endpoints", () => {
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

  it("getDocumentShares parses the overview", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(accessBody()));
    const out = await getDocumentShares("d1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/documents/d1/shares");
    expect(out?.my_level).toBe("manage");
    expect(out?.shares?.[0]?.level).toBe("view");
    expect(out?.links?.[0]?.id).toBe("l1");
  });

  it("getDocumentShares keeps a non-manage answer small", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ my_level: "view", via: "share" }));
    const out = await getDocumentShares("d1");
    expect(out?.my_level).toBe("view");
    expect(out?.shares).toBeUndefined();
  });

  it("shareDocument posts the principal body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ share: share() }));
    const out = await shareDocument("d1", { principal_type: "user", principal_id: "u2", level: "view" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/shares");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      principal_type: "user",
      principal_id: "u2",
      level: "view",
    });
    expect(out?.share.id).toBe("s1");
  });

  it("revokeDocumentShare and revokeDocumentLink use DELETE", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json({ status: "ok" }));
    await revokeDocumentShare("d1", "s1");
    await revokeDocumentLink("d1", "l1");
    const [shareUrl, shareInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(shareUrl)).toBe("http://api.test/api/v1/documents/d1/shares/s1");
    expect(shareInit?.method).toBe("DELETE");
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/documents/d1/links/l1");
    expect(vi.mocked(fetch).mock.calls[1]![1]?.method).toBe("DELETE");
  });

  it("createDocumentLink posts the expiry (or nothing)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ link: link(), token: "tok-1", url: "/share/tok-1" }));
    const out = await createDocumentLink("d1", 7);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/links");
    expect(JSON.parse(String(init?.body))).toEqual({ expires_in_days: 7 });
    expect(out?.token).toBe("tok-1");

    vi.mocked(fetch).mockResolvedValueOnce(json({ link: link(), token: "tok-2", url: "/share/tok-2" }));
    await createDocumentLink("d1");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({});
  });

  it("listDocumentAccessLogs sends the action filter and parses the rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ logs: [logRow()], next_cursor: "n1" }));
    const out = await listDocumentAccessLogs("d1", { action: "view", limit: 10, cursor: "c1" });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/v1/documents/d1/access-logs");
    expect(parsed.searchParams.get("action")).toBe("view");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("cursor")).toBe("c1");
    expect(out.logs[0]?.actor?.display_name).toBe("B");
    expect(out.next_cursor).toBe("n1");
  });

  it("setDocumentPublicLinks PUTs the switch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ organization_id: "o1", public_links_enabled: true, updated_by: "u1", updated_at: "x" }),
    );
    const out = await setDocumentPublicLinks("o1", true);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/o1/documents/settings");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ public_links_enabled: true });
    expect(out?.public_links_enabled).toBe(true);
  });

  // ---- malformed responses: one per endpoint -----------------------------

  it.each(malformedBodies)("getDocumentShares degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentShares("d1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("shareDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(
      shareDocument("d1", { principal_type: "user", principal_id: "u2", level: "view" }),
    ).resolves.toBeNull();
  });

  it.each(malformedBodies)("createDocumentLink degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(createDocumentLink("d1", 7)).resolves.toBeNull();
  });

  it.each(malformedBodies)("listDocumentAccessLogs throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listDocumentAccessLogs("d1")).rejects.toThrow("document_access_log_invalid");
  });

  it.each(malformedBodies)("setDocumentPublicLinks degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(setDocumentPublicLinks("o1", true)).resolves.toBeNull();
  });

  it("a link answer without the token is not verifiable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ link: link(), url: "/share/x" }));
    await expect(createDocumentLink("d1")).resolves.toBeNull();
  });

  it("a log row without actor_kind is not a parseable row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ logs: [{ id: "g1", action: "view" }] }));
    await expect(listDocumentAccessLogs("d1")).rejects.toThrow("document_access_log_invalid");
  });
});
