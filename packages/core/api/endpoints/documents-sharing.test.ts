import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { ApiError } from "../http";
import {
  createDocumentLink,
  getDocumentSettings,
  getDocumentShares,
  listDocumentAccessLogs,
  listShareCandidates,
  parseDocumentAccessRejected,
  revokeDocumentLink,
  revokeDocumentShare,
  setDocumentPublicLinks,
  shareDocument,
  shareDocumentBatch,
  updateDocumentAccess,
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

  it("shareDocumentBatch posts the user ids and one level to the batch route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ shares: [share({ id: "s1", principal_id: "u2" }), share({ id: "s2", principal_id: "u3" })] }),
    );
    const out = await shareDocumentBatch("d1", { principal_ids: ["u2", "u3"], level: "view" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/shares/batch");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ principal_ids: ["u2", "u3"], level: "view" });
    expect(out?.shares.map((row) => row.id)).toEqual(["s1", "s2"]);
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

  it("getDocumentSettings reads the switch (G1-08)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ organization_id: "o1", public_links_enabled: false }),
    );
    const out = await getDocumentSettings("o1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/o1/documents/settings");
    expect(init?.method ?? "GET").toBe("GET");
    expect(out).toEqual({ organization_id: "o1", public_links_enabled: false });
  });

  // ---- malformed responses: one per endpoint -----------------------------

  it.each(malformedBodies)("getDocumentShares degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentShares("d1")).resolves.toBeNull();
  });

  it("getDocumentShares keeps an admin-only answer whose level is empty or omitted, and still degrades a body with no level", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ my_level: "", admin_scope: true, break_glass: [] }));
    await expect(getDocumentShares("d1")).resolves.toMatchObject({ my_level: "", admin_scope: true });
    vi.mocked(fetch).mockResolvedValueOnce(json({ admin_scope: true }));
    await expect(getDocumentShares("d1")).resolves.toMatchObject({ my_level: "" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ via: "member" }));
    await expect(getDocumentShares("d1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("shareDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(
      shareDocument("d1", { principal_type: "user", principal_id: "u2", level: "view" }),
    ).resolves.toBeNull();
  });

  it.each([...malformedBodies, { shares: "x" }, { shares: [{ nope: true }] }])(
    "shareDocumentBatch degrades %#",
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(shareDocumentBatch("d1", { principal_ids: ["u2"], level: "view" })).resolves.toBeNull();
    },
  );

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

  it.each(malformedBodies)("getDocumentSettings degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentSettings("o1")).resolves.toBeNull();
  });

  it("a link answer without the token is not verifiable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ link: link(), url: "/share/x" }));
    await expect(createDocumentLink("d1")).resolves.toBeNull();
  });

  it("a log row without actor_kind is not a parseable row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ logs: [{ id: "g1", action: "view" }] }));
    await expect(listDocumentAccessLogs("d1")).rejects.toThrow("document_access_log_invalid");
  });

  // ---- SH-S2: sources, home_workspace, updateDocumentAccess, listShareCandidates ----

  it("getDocumentShares parses my_sources, home_workspace, and per-share sources and warnings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        accessBody({
          my_sources: [
            { via: "share", principal_type: "user", principal_id: "u1", level: "edit" },
            { via: "member", principal_type: "workspace", principal_id: "w1", level: "view" },
          ],
          home_workspace: { workspace_id: "w1", workspace_name: "Kinh doanh", level: "edit" },
          shares: [
            share({
              sources: [
                { via: "share", principal_type: "user", principal_id: "u2", level: "view" },
                { via: "share", principal_type: "organization", principal_id: "o1", level: "edit" },
              ],
              warnings: ["direct_below_group"],
            }),
          ],
        }),
      ),
    );
    const out = await getDocumentShares("d1");
    expect(out?.my_sources).toEqual([
      { via: "share", principal_type: "user", principal_id: "u1", level: "edit" },
      { via: "member", principal_type: "workspace", principal_id: "w1", level: "view" },
    ]);
    expect(out?.home_workspace).toEqual({ workspace_id: "w1", workspace_name: "Kinh doanh", level: "edit" });
    expect(out?.shares?.[0]?.sources).toHaveLength(2);
    expect(out?.shares?.[0]?.warnings).toEqual(["direct_below_group"]);
  });

  it("getDocumentShares drops malformed source entries and malformed home_workspace without failing the overview", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        accessBody({
          my_sources: [{ via: "owner", level: "manage" }, { nope: true }, null],
          home_workspace: "not-an-object",
          shares: [
            share({
              sources: [{ via: "member", principal_type: "workspace", principal_id: "w1", level: "view" }, "bad"],
              warnings: "not-an-array",
            }),
          ],
        }),
      ),
    );
    const out = await getDocumentShares("d1");
    expect(out?.my_sources).toEqual([
      { via: "owner", principal_type: undefined, principal_id: undefined, level: "manage" },
    ]);
    expect(out?.home_workspace).toBeUndefined();
    expect(out?.shares?.[0]?.sources).toEqual([
      { via: "member", principal_type: "workspace", principal_id: "w1", level: "view" },
    ]);
    expect(out?.shares?.[0]?.warnings).toBeUndefined();
  });

  it("updateDocumentAccess PUTs items and dry_run and parses results and preview", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        batch_id: "01JBATCH",
        dry_run: true,
        results: [
          { index: 0, status: "granted" },
          { index: 1, status: "revoked" },
        ],
        preview: {
          users: [
            {
              user_id: "u2",
              before: { level: "edit", via: "share" },
              after: { level: "view", via: "member" },
            },
          ],
          groups: [
            {
              principal_type: "workspace",
              principal_id: "w1",
              member_count: 12,
              losing_count: 3,
            },
          ],
          warnings: [{ code: "direct_below_group", index: 0 }],
        },
      }),
    );
    const out = await updateDocumentAccess("d1", {
      items: [
        { principal_type: "user", principal_id: "u2", level: "edit", on_existing: "keep" },
        { principal_type: "workspace", principal_id: "w1", level: null },
      ],
      dry_run: true,
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/access");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      items: [
        { principal_type: "user", principal_id: "u2", level: "edit", on_existing: "keep" },
        { principal_type: "workspace", principal_id: "w1", level: null },
      ],
      dry_run: true,
    });
    expect(out?.batch_id).toBe("01JBATCH");
    expect(out?.dry_run).toBe(true);
    expect(out?.results).toEqual([
      { index: 0, status: "granted" },
      { index: 1, status: "revoked" },
    ]);
    expect(out?.preview.users[0]?.after).toEqual({ level: "view", via: "member" });
    expect(out?.preview.groups[0]?.losing_count).toBe(3);
    expect(out?.preview.warnings).toEqual([{ code: "direct_below_group", index: 0 }]);
  });

  it.each([
    ...malformedBodies,
    { batch_id: "", results: [] },
    { batch_id: "b1", results: "x" },
    { batch_id: "b1", results: [{ index: "bad", status: "granted" }] },
  ])("updateDocumentAccess degrades malformed response %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(
      updateDocumentAccess("d1", {
        items: [{ principal_type: "user", principal_id: "u2", level: "view" }],
      }),
    ).resolves.toBeNull();
  });

  it("listShareCandidates sends q, cursor, limit and parses candidates", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        items: [
          {
            principal_type: "user",
            principal_id: "u2",
            name: "Nguyễn An",
            secondary: "an@acme.vn",
            direct_level: "view",
            is_home_workspace: false,
          },
          {
            principal_type: "workspace",
            principal_id: "w1",
            name: "Kinh doanh",
            secondary: "",
            direct_level: null,
            is_home_workspace: true,
          },
          {
            principal_type: "organization",
            principal_id: "o1",
            name: "Acme",
            secondary: "",
            direct_level: null,
            is_home_workspace: false,
          },
        ],
        next_cursor: "c2",
      }),
    );
    const out = await listShareCandidates("d1", { q: "  an ", cursor: "c1", limit: 20 });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/v1/documents/d1/share-candidates");
    expect(parsed.searchParams.get("q")).toBe("an");
    expect(parsed.searchParams.get("cursor")).toBe("c1");
    expect(parsed.searchParams.get("limit")).toBe("20");
    expect(out.items).toHaveLength(3);
    expect(out.items[0]?.direct_level).toBe("view");
    expect(out.items[1]?.is_home_workspace).toBe(true);
    expect(out.next_cursor).toBe("c2");
  });

  it.each([...malformedBodies, { items: "x" }])(
    "listShareCandidates degrades malformed response %#",
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(listShareCandidates("d1")).resolves.toEqual({ items: [], next_cursor: "" });
    },
  );

  it("listShareCandidates drops malformed candidate rows while keeping valid ones", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        items: [
          { principal_type: "user", principal_id: "u2", name: "Bình", secondary: "b@acme.vn", direct_level: null },
          { principal_type: "user", principal_id: "", name: "Empty id" },
          { nope: true },
          null,
        ],
        next_cursor: null,
      }),
    );
    const out = await listShareCandidates("d1");
    expect(out).toEqual({
      items: [
        {
          principal_type: "user",
          principal_id: "u2",
          name: "Bình",
          secondary: "b@acme.vn",
          direct_level: null,
          is_home_workspace: false,
        },
      ],
      next_cursor: "",
    });
  });

  it("parseDocumentAccessRejected extracts typed rejected items and ignores malformed entries", () => {
    const err = new ApiError("rejected", "document_access_rejected", 422, undefined, {
      rejected: [
        { index: 1, principal_type: "organization", principal_id: "o1", code: "level_not_allowed" },
        { index: 2, principal_type: "user", principal_id: "u9", code: "principal_not_in_organization" },
        { index: "bad", principal_type: "user", principal_id: "u8", code: "duplicate_principal" },
        null,
      ],
    });
    const parsed = parseDocumentAccessRejected(err);
    expect(parsed).toEqual({
      code: "document_access_rejected",
      status: 422,
      message: "rejected",
      rejected: [
        { index: 1, principal_type: "organization", principal_id: "o1", code: "level_not_allowed" },
        { index: 2, principal_type: "user", principal_id: "u9", code: "principal_not_in_organization" },
      ],
    });
    expect(parseDocumentAccessRejected(new ApiError("other", "forbidden", 403))).toBeNull();
    expect(parseDocumentAccessRejected(new Error("network"))).toBeNull();
  });
});
