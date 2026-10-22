import { describe, expect, it } from "vitest";
import { DocumentAccessReportSchema, type AccessReportDocument } from "../types/document-access-report";
import { deriveReportFacts } from "./access-report-facts";

const WS = "ws1";

type RawRow = Record<string, unknown>;

const ownerRow = (): RawRow => ({ source: "acl_owner", via: "member", principal_type: "user", principal_id: "u1", principal_name: "An", level: "manage" });
const homeRow = (level = "edit"): RawRow => ({ source: "workspace", via: "workspace", principal_type: "workspace", principal_id: WS, level });
const shareRow = (over: RawRow): RawRow => ({ source: "share", via: "share", principal_type: "user", principal_id: "u2", level: "view", share_id: "s1", ...over });
const linkRow = (id = "l1"): RawRow => ({ source: "link", via: "link", principal_type: "link", principal_id: id, level: "view" });

/** Parse through the real schema so every default the screen sees is in place. */
function build(docOver: RawRow, rows: RawRow[]) {
  const parsed = DocumentAccessReportSchema.parse({
    scope: { kind: "workspace", workspace_id: WS },
    documents: [
      {
        document: {
          id: "d1",
          visibility: "workspace",
          acl_owner: { id: "u1", name: "An" },
          updated_at: "2026-10-01T00:00:00Z",
          ...docOver,
        },
        rows,
      },
    ],
  });
  const d: AccessReportDocument = parsed.documents[0]!;
  return deriveReportFacts(d.document, d.rows, WS);
}

describe("deriveReportFacts: flags follow the tile definitions (UNI-2039)", () => {
  it("raises nothing for an owner row plus the workspace default", () => {
    const f = build({}, [ownerRow(), homeRow("manage")]);
    expect(f.flags).toEqual([]);
  });

  it("public_link: a live link row, or the count while the server sends no link rows", () => {
    expect(build({}, [ownerRow(), linkRow()]).flags).toEqual(["public_link"]);
    expect(build({ live_link_count: 2 }, [ownerRow()]).flags).toEqual(["public_link"]);
    expect(build({ live_link_count: 2 }, [ownerRow(), linkRow()]).links).toBe(1);
    expect(build({ live_link_count: 2 }, [ownerRow()]).links).toBe(2);
  });

  it("other_workspace: a live share to a workspace other than this one, not the home workspace", () => {
    expect(build({}, [ownerRow(), shareRow({ principal_type: "workspace", principal_id: "ws9" })]).flags).toEqual(["other_workspace"]);
    expect(build({}, [ownerRow(), shareRow({ principal_type: "workspace", principal_id: WS })]).flags).toEqual([]);
  });

  it("organization: a live share to the organization", () => {
    const f = build({ visibility: "workspace" }, [ownerRow(), shareRow({ principal_type: "organization", principal_id: "o1" })]);
    expect(f.flags).toEqual(["organization"]);
    expect(f.organizationWide).toBe(true);
  });

  it("direct_manage: a live share at manage to someone but the ACL owner", () => {
    expect(build({}, [ownerRow(), shareRow({ level: "manage" })]).flags).toEqual(["direct_manage"]);
    expect(build({}, [ownerRow(), shareRow({ level: "edit" })]).flags).toEqual([]);
    expect(build({}, [ownerRow(), shareRow({ principal_id: "u1", level: "manage" })]).flags).toEqual([]);
  });

  it("direct_manage ignores the owner row, the workspace default and break-glass", () => {
    const glass: RawRow = { source: "break_glass", via: "break_glass", principal_type: "user", principal_id: "u7", level: "manage" };
    expect(build({}, [ownerRow(), homeRow("manage"), glass]).flags).toEqual([]);
  });

  it("an inactive row raises no flag", () => {
    expect(build({}, [ownerRow(), shareRow({ level: "manage", active: false })]).flags).toEqual([]);
  });

  it("lists flags in a stable order", () => {
    const f = build({}, [
      ownerRow(),
      shareRow({ level: "manage" }),
      shareRow({ principal_type: "organization", principal_id: "o1", share_id: "s2" }),
      shareRow({ principal_type: "workspace", principal_id: "ws9", share_id: "s3" }),
      linkRow(),
    ]);
    expect(f.flags).toEqual(["public_link", "other_workspace", "organization", "direct_manage"]);
  });

  it("trusts the server flags, an empty list included; only null or absent derives", () => {
    expect(build({ flags: ["organization"] }, [ownerRow(), linkRow()]).flags).toEqual(["organization"]);
    expect(build({ flags: [] }, [ownerRow(), linkRow()]).flags).toEqual([]);
    expect(build({ flags: null }, [ownerRow(), linkRow()]).flags).toEqual(["public_link"]);
    expect(build({ flags: "oops" }, [ownerRow(), linkRow()]).flags).toEqual([]);
    expect(build({ flags: ["from_the_future"] }, [ownerRow(), linkRow()]).flags).toEqual([]);
  });
});

describe("deriveReportFacts: general scope, counts and change time (UNI-2039)", () => {
  it("reads private from a restricted visibility", () => {
    expect(build({ visibility: "restricted" }, [ownerRow()]).generalScope).toEqual({ kind: "restricted", level: null });
  });

  it("reads the workspace level off the workspace-default row", () => {
    expect(build({}, [ownerRow(), homeRow("comment")]).generalScope).toEqual({ kind: "workspace", level: "comment" });
    expect(build({}, [ownerRow()]).generalScope).toEqual({ kind: "workspace", level: null });
  });

  it("reads the whole organization, with its level, when a live organization share exists", () => {
    const rows = [ownerRow(), shareRow({ principal_type: "organization", principal_id: "o1", level: "view" })];
    expect(build({ visibility: "restricted" }, rows).generalScope).toEqual({ kind: "organization", level: "view" });
  });

  it("an inactive organization share does not widen the scope", () => {
    const rows = [ownerRow(), shareRow({ principal_type: "organization", principal_id: "o1", active: false })];
    expect(build({ visibility: "restricted" }, rows).generalScope.kind).toBe("restricted");
  });

  it("trusts a server general_scope over the rows", () => {
    const f = build({ visibility: "workspace", general_scope: { kind: "restricted", level: null } }, [ownerRow(), homeRow()]);
    expect(f.generalScope).toEqual({ kind: "restricted", level: null });
  });

  it("derives from visibility when the server general_scope is unreadable", () => {
    expect(build({ visibility: "restricted", general_scope: { kind: 4 } }, [ownerRow()]).generalScope.kind).toBe("restricted");
  });

  it("counts distinct live people, other workspaces and links", () => {
    const f = build({}, [
      ownerRow(),
      homeRow(),
      shareRow({ principal_id: "u2" }),
      shareRow({ principal_id: "u2", share_id: "s2" }),
      shareRow({ principal_id: "u3", active: false, share_id: "s3" }),
      shareRow({ principal_type: "workspace", principal_id: "ws9", share_id: "s4" }),
      shareRow({ principal_type: "workspace", principal_id: "ws9", share_id: "s5" }),
      linkRow("l1"),
      linkRow("l2"),
    ]);
    expect(f.people).toBe(2);
    expect(f.otherWorkspaces).toBe(1);
    expect(f.links).toBe(2);
    expect(f.workspaceWide).toBe(true);
  });

  it("is not workspace-wide when private", () => {
    expect(build({ visibility: "restricted" }, [ownerRow()]).workspaceWide).toBe(false);
  });

  it("uses the server access_changed_at, else updated_at", () => {
    expect(build({ access_changed_at: "2026-10-20T00:00:00Z" }, [ownerRow()]).changedAt).toBe("2026-10-20T00:00:00Z");
    expect(build({}, [ownerRow()]).changedAt).toBe("2026-10-01T00:00:00Z");
  });
});
