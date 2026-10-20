import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveReportFacts } from "../../documents/access-report-facts";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  exportDocumentAccessReport,
  getDocumentAccessReport,
  getDocumentAccessReportPrincipals,
  getDocumentAccessReportSummary,
} from "./documents-access-report";

// UNI-2039 ACCESS-REPORT-REDESIGN: the new optional fields, filters, sort, the
// whole-scope summary (S6) and the principal totals (S7). The UNI-1643 cases
// stay in documents-access-report.test.ts.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const row = (over: Record<string, unknown> = {}) => ({
  source: "share",
  via: "share",
  principal_type: "workspace",
  principal_id: "ws9",
  principal_name: "Pháp chế",
  level: "view",
  effective_level: "view",
  active: true,
  granted_by: "u1",
  granted_by_name: "Nguyễn An",
  granted_by_kind: "human",
  granted_at: "2026-10-10T03:00:00Z",
  share_id: "s1",
  ...over,
});

const page = (docOver: Record<string, unknown> = {}, rowOver: Record<string, unknown> = {}) => ({
  scope: { kind: "workspace", workspace_id: "ws1", folder_id: null, folder_title: null },
  filter: { person_id: null, level: [], visibility: null },
  generated_at: "2026-10-21T03:00:00Z",
  documents: [
    {
      document: {
        id: "d1",
        title: "Hợp đồng ABC",
        kind: "file",
        visibility: "restricted",
        path: [],
        acl_owner: { id: "u1", name: "Nguyễn An" },
        live_link_count: 0,
        updated_at: "2026-10-14T09:00:00Z",
        ...docOver,
      },
      rows: [row(rowOver)],
    },
  ],
  summary: { candidates: 1, documents: 1, rows: 1, skipped: 0 },
  next_cursor: null,
});

const firstDoc = (out: Awaited<ReturnType<typeof getDocumentAccessReport>>) => out!.documents[0]!;
const lastUrl = () => new URL(String(vi.mocked(fetch).mock.calls.at(-1)![0]));

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

describe("access report page: sort and the new filters (UNI-2039 S4, S5)", () => {
  it("sends sort, order and every new filter when set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page()));
    await getDocumentAccessReport("ws1", {
      sort: "title",
      order: "asc",
      q: "  hợp đồng ",
      principal: "user:u2",
      scope: "organization",
      sources: ["direct", "chat"],
      flag: "public_link",
      nonDefault: true,
    });
    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({
      sort: "title",
      order: "asc",
      q: "hợp đồng",
      principal: "user:u2",
      scope: "organization",
      source: "direct,chat",
      flag: "public_link",
      non_default: "1",
    });
  });

  it("omits a blank q, empty sources, nonDefault=false and empty strings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page()));
    await getDocumentAccessReport("ws1", { q: "   ", sources: [], nonDefault: false, principal: "", scope: "", flag: "" });
    expect(lastUrl().search).toBe("");
  });

  it("sends the new filters, but not sort, with an export", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("x", { status: 200 }));
    await exportDocumentAccessReport("ws1", { flag: "direct_manage", sources: ["link"], nonDefault: true }, "csv");
    const sp = lastUrl().searchParams;
    expect(sp.get("flag")).toBe("direct_manage");
    expect(sp.get("source")).toBe("link");
    expect(sp.get("non_default")).toBe("1");
    expect(sp.has("sort")).toBe(false);
  });
});

describe("access report page: the new document and row fields (UNI-2039 S1-S3)", () => {
  it("reads every new field", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        page(
          {
            general_scope: { kind: "organization", level: "view" },
            flags: ["public_link", "organization"],
            access_changed_at: "2026-10-16T01:00:00Z",
            my_level: "manage",
            admin_scope: true,
          },
          { origin: "chat", expires_at: "2026-11-01T00:00:00Z", revoke_target: { kind: "share", id: "s1" } },
        ),
      ),
    );
    const doc = firstDoc(await getDocumentAccessReport("ws1"));
    expect(doc.document.general_scope).toEqual({ kind: "organization", level: "view" });
    expect(doc.document.flags).toEqual(["public_link", "organization"]);
    expect(doc.document.access_changed_at).toBe("2026-10-16T01:00:00Z");
    expect(doc.document.my_level).toBe("manage");
    expect(doc.document.admin_scope).toBe(true);
    expect(doc.rows[0]).toMatchObject({
      origin: "chat",
      expires_at: "2026-11-01T00:00:00Z",
      revoke_target: { kind: "share", id: "s1" },
    });
  });

  it("parses a page from a server that has none of them", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page()));
    const doc = firstDoc(await getDocumentAccessReport("ws1"));
    expect(doc.document.flags).toBeNull();
    expect(doc.document.general_scope).toBeNull();
    expect(doc.document.admin_scope).toBe(false);
    expect(doc.document.my_level).toBeNull();
    expect(doc.rows[0]).toMatchObject({ origin: null, expires_at: null, revoke_target: null });
  });

  it.each([["x"], [{ a: 1 }], [7]])("reads flags %j that is not an array as no flags", async (flags) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({ flags })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).document.flags).toEqual([]);
  });

  it("drops an unknown flag and keeps the known ones", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({ flags: ["public_link", "from_the_future", 3, null] })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).document.flags).toEqual(["public_link"]);
  });

  it.each([
    ["a string", "share"],
    ["missing its id", { kind: "share" }],
    ["an empty id", { kind: "link", id: "" }],
    ["an unknown kind", { kind: "teleport", id: "x1" }],
    ["a numeric id", { kind: "share", id: 4 }],
    ["an array", []],
  ])("reads a revoke_target that is %s as null so Revoke stays hidden", async (_name, revoke_target) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({}, { revoke_target })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).rows[0]?.revoke_target).toBeNull();
  });

  it.each([[{ level: "view" }], [{ kind: "" }], [{ kind: 4 }], ["workspace"]])(
    "reads a broken general_scope %j as null so it is derived from visibility",
    async (general_scope) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(page({ general_scope })));
      expect(firstDoc(await getDocumentAccessReport("ws1")).document.general_scope).toBeNull();
    },
  );

  it("keeps an unknown general_scope kind, origin and source as plain strings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(page({ general_scope: { kind: "galaxy", level: 4 } }, { origin: "carrier_pigeon", source: "teleport" })),
    );
    const doc = firstDoc(await getDocumentAccessReport("ws1"));
    expect(doc.document.general_scope).toEqual({ kind: "galaxy", level: null });
    expect(doc.rows[0]).toMatchObject({ origin: "carrier_pigeon", source: "teleport" });
  });

  it.each([[undefined], [null], [""]])("uses updated_at when access_changed_at is %j", async (access_changed_at) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({ access_changed_at })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).document.access_changed_at).toBe("2026-10-14T09:00:00Z");
  });
});

const summary = (over: Record<string, unknown> = {}) => ({
  generated_at: "2026-10-21T03:00:00Z",
  tiles: { public_link: 3, outside_workspace: 2, direct_manage: 4, documents: 11, restricted: 7, workspace: 4, organization: 1 },
  matching_documents: 8,
  skipped: 5,
  truncated: false,
  ...over,
});

describe("getDocumentAccessReportSummary (UNI-2039 S6)", () => {
  it("parses the totals and sends the folder and filters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(summary()));
    const out = await getDocumentAccessReportSummary("ws1", { folderId: "f1", flag: "public_link", nonDefault: true });
    const url = lastUrl();
    expect(url.pathname).toBe("/api/v1/workspaces/ws1/documents/access-report/summary");
    expect(url.searchParams.get("folder_id")).toBe("f1");
    expect(url.searchParams.get("flag")).toBe("public_link");
    expect(url.searchParams.get("non_default")).toBe("1");
    expect(out?.tiles.public_link).toBe(3);
    expect(out?.matching_documents).toBe(8);
    expect(out?.skipped).toBe(5);
    expect(out?.truncated).toBe(false);
  });

  it("sends nothing by default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(summary()));
    await getDocumentAccessReportSummary("ws1");
    expect(lastUrl().search).toBe("");
  });

  it.each([[{ nope: true }], [{ tiles: "x" }], [{ tiles: null }], [{ tiles: {} }], [{ tiles: { documents: 2 } }], [null], [[]], ["str"], [7]])(
    "degrades to null on a malformed body %j so the tiles show an error, not 0",
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(getDocumentAccessReportSummary("ws1")).resolves.toBeNull();
    },
  );
});

const principals = (over: Record<string, unknown> = {}) => ({
  generated_at: "2026-10-21T03:00:00Z",
  principals: [
    {
      principal_type: "user",
      principal_id: "u1",
      principal_name: "Nguyễn An",
      kind: "member",
      member_count: null,
      document_count: 6,
      levels: { view: 1, comment: 0, edit: 3, manage: 2 },
      main_source: "direct",
    },
    {
      principal_type: "link",
      principal_id: null,
      principal_name: null,
      kind: "link",
      member_count: null,
      document_count: 2,
      levels: { view: 2, comment: 0, edit: 0, manage: 0 },
      main_source: "link",
    },
  ],
  truncated: false,
  ...over,
});

describe("getDocumentAccessReportPrincipals (UNI-2039 S7)", () => {
  it("parses the principals and sends folder, q, kind, level, sort and order", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(principals()));
    const out = await getDocumentAccessReportPrincipals("ws1", {
      folderId: "f1",
      q: " an ",
      kind: "member",
      levels: ["edit", "manage"],
      sort: "name",
      order: "asc",
    });
    const url = lastUrl();
    expect(url.pathname).toBe("/api/v1/workspaces/ws1/documents/access-report/principals");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      folder_id: "f1",
      q: "an",
      kind: "member",
      level: "edit,manage",
      sort: "name",
      order: "asc",
    });
    expect(out?.principals).toHaveLength(2);
    expect(out?.principals[0]).toMatchObject({ principal_name: "Nguyễn An", document_count: 6, main_source: "direct" });
    expect(out?.principals[1]?.principal_id).toBeNull();
    expect(out?.truncated).toBe(false);
  });

  it("sends nothing by default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(principals()));
    await getDocumentAccessReportPrincipals("ws1");
    expect(lastUrl().search).toBe("");
  });

  it("keeps an unknown kind and main_source, defaults missing counts, drops a broken entry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(principals({ principals: [{ principal_type: "robot", kind: "bot", main_source: "x" }, { document_count: 3 }, 5] })),
    );
    const out = await getDocumentAccessReportPrincipals("ws1");
    expect(out?.principals).toHaveLength(1);
    expect(out?.principals[0]).toMatchObject({
      kind: "bot",
      main_source: "x",
      document_count: 0,
      levels: { view: 0, comment: 0, edit: 0, manage: 0 },
      principal_id: null,
      member_count: null,
    });
  });

  it.each([[{ nope: true }], [{ principals: "x" }], [null], [[]], ["str"], [7]])(
    "degrades to null on a malformed body %j",
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(getDocumentAccessReportPrincipals("ws1")).resolves.toBeNull();
    },
  );

  it("reads a Go nil principals slice (null) as an empty list, not an error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(principals({ principals: null })));
    const out = await getDocumentAccessReportPrincipals("ws1");
    expect(out?.principals).toEqual([]);
  });

  it("caps q at 100 characters, the server's limit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(principals()));
    await getDocumentAccessReportPrincipals("ws1", { q: "ệ".repeat(120) });
    expect(Array.from(lastUrl().searchParams.get("q") ?? "")).toHaveLength(100);
  });
});

// The server answers every new field with its Go zero value until it fills
// them (SDO f1a936827): "" strings, general_scope {kind:"",level:null}, nil
// flags (null), a zero time, a revoke_target that is null. All of that is
// "missing", so the screen derives from the rows instead of showing blanks.
describe("access report page: zero values from the SDO read as missing (UNI-2039)", () => {
  const zeroDoc = {
    general_scope: { kind: "", level: null },
    flags: null,
    access_changed_at: "",
    my_level: "",
    admin_scope: false,
  };
  const zeroRow = { revoke_target: null, expires_at: null };

  it("reads a page of zero-valued new fields as a page without them", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page(zeroDoc, zeroRow)));
    const doc = firstDoc(await getDocumentAccessReport("ws1"));
    expect(doc.document).toMatchObject({
      general_scope: null,
      flags: null,
      access_changed_at: "2026-10-14T09:00:00Z",
      my_level: null,
      admin_scope: false,
    });
    expect(doc.rows[0]).toMatchObject({ origin: null, expires_at: null, revoke_target: null });
  });

  it("derives the facts of a zero-valued page from its rows", async () => {
    const rows = [
      row({ source: "owner", principal_type: "user", principal_id: "u1", level: "manage" }),
      row({ source: "share", principal_type: "workspace", principal_id: "ws9", level: "edit" }),
    ];
    const body = page(zeroDoc, zeroRow);
    body.documents[0]!.rows = rows;
    body.documents[0]!.document.live_link_count = 1;
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    const doc = firstDoc(await getDocumentAccessReport("ws1"));
    const facts = deriveReportFacts(doc.document, doc.rows, "ws1");
    expect(facts.flags).toEqual(["public_link", "other_workspace"]);
    expect(facts.generalScope).toEqual({ kind: "restricted", level: null });
    expect(facts.changedAt).toBe("2026-10-14T09:00:00Z");
  });

  it("reads an empty flags array as not answered, so the flags are derived", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({ flags: [] })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).document.flags).toBeNull();
  });

  it("keeps [] when the server named flags and all of them are unknown", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({ flags: ["from_the_future"] })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).document.flags).toEqual([]);
  });

  it.each([["0001-01-01T00:00:00Z"], ["1970-01-01T00:00:00Z"]])(
    "uses updated_at when access_changed_at is the zero time %s",
    async (access_changed_at) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(page({ access_changed_at })));
      expect(firstDoc(await getDocumentAccessReport("ws1")).document.access_changed_at).toBe("2026-10-14T09:00:00Z");
    },
  );

  it.each([[""], ["0001-01-01T00:00:00Z"]])("reads expires_at %j as no expiry", async (expires_at) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({}, { expires_at })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).rows[0]?.expires_at).toBeNull();
  });

  it("reads an empty origin as absent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({}, { origin: "" })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).rows[0]?.origin).toBeNull();
  });

  it("reads a zero-valued revoke_target {kind:'',id:''} as null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({}, { revoke_target: { kind: "", id: "" } })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).rows[0]?.revoke_target).toBeNull();
  });

  it("keeps my_level none: it is an answer, not a zero value", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({ my_level: "none" })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).document.my_level).toBe("none");
  });
});

// Go marshals a nil slice as null; a null here must not drop the document or
// fail the page (the SDO does not promise non-nil slices).
describe("access report page: Go nil slices (UNI-2039)", () => {
  it("keeps a document whose rows is null, with no rows", async () => {
    const body = page();
    (body.documents[0] as { rows: unknown }).rows = null;
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    const doc = firstDoc(await getDocumentAccessReport("ws1"));
    expect(doc.document.id).toBe("d1");
    expect(doc.rows).toEqual([]);
  });

  it("keeps a document whose path is null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page({ path: null })));
    expect(firstDoc(await getDocumentAccessReport("ws1")).document.path).toEqual([]);
  });

  it("reads filter.level null as no level filter", async () => {
    const body = page();
    (body.filter as { level: unknown }).level = null;
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    expect((await getDocumentAccessReport("ws1"))?.filter.level).toEqual([]);
  });

  it("reads documents null as an empty page", async () => {
    const body = { ...page(), documents: null };
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    expect((await getDocumentAccessReport("ws1"))?.documents).toEqual([]);
  });
});

describe("access report: q is capped at the server's 100 characters (UNI-2039 S5)", () => {
  const long = "ệ".repeat(120);

  it.each([
    ["the page", () => getDocumentAccessReport("ws1", { q: long }), () => json(page())],
    ["the summary", () => getDocumentAccessReportSummary("ws1", { q: long }), () => json(summary())],
    ["the export", () => exportDocumentAccessReport("ws1", { q: long }, "csv"), () => new Response("x")],
  ])("on %s", async (_name, call, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(body());
    await call();
    expect(Array.from(lastUrl().searchParams.get("q") ?? "")).toHaveLength(100);
  });
});
