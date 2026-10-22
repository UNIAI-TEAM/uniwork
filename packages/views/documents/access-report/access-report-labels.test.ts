import { describe, expect, it } from "vitest";
import {
  accessSourceLabel,
  flagLabel,
  generalScopeLabel,
  grantKindNote,
  principalTypeLabel,
  whoSummary,
} from "./access-report-labels";

// A stub that answers with the key and its options, so the test sees which key a label asks for.
const key = ((k: string, opts?: Record<string, unknown>) =>
  opts ? `${k}${JSON.stringify(opts)}` : k) as unknown as Parameters<typeof principalTypeLabel>[0];

const WS = "ws1";

function row(over: Record<string, unknown> = {}) {
  return {
    source: "share",
    principal_type: "user",
    principal_id: "u2",
    principal_name: "Trần Bình",
    active: true,
    origin: null as string | null,
    ...over,
  };
}

describe("principalTypeLabel", () => {
  it("names the principal types the share panel knows", () => {
    expect(principalTypeLabel(key, "user")).toBe("documents.share.principal_user");
    expect(principalTypeLabel(key, "workspace")).toBe("documents.share.principal_workspace");
  });

  it("asks for its own key for a principal type it does not know, not a level key", () => {
    expect(principalTypeLabel(key, "robot")).toBe("documents.accessReport.principal_other");
  });
});

describe("accessSourceLabel", () => {
  it("reads a share by its origin, and a share without one as shared directly", () => {
    expect(accessSourceLabel(key, row({ origin: "chat" }))).toBe("documents.accessReport.source_chat");
    expect(accessSourceLabel(key, row({ origin: "direct" }))).toBe("documents.accessReport.source_direct");
    expect(accessSourceLabel(key, row({ origin: null }))).toBe("documents.accessReport.source_direct");
  });

  it("names the owner, the workspace default, a link and break-glass", () => {
    expect(accessSourceLabel(key, row({ source: "acl_owner" }))).toBe("documents.accessReport.source_acl_owner");
    expect(accessSourceLabel(key, row({ source: "workspace" }))).toBe("documents.accessReport.source_workspace_default");
    expect(accessSourceLabel(key, row({ source: "link" }))).toBe("documents.accessReport.source_link");
    expect(accessSourceLabel(key, row({ source: "break_glass" }))).toBe("documents.accessReport.source_break_glass");
  });

  it("reads an unknown source or share origin as Other", () => {
    expect(accessSourceLabel(key, row({ source: "magic" }))).toBe("documents.accessReport.source_other");
    expect(accessSourceLabel(key, row({ origin: "email" }))).toBe("documents.accessReport.source_other");
  });
});

describe("generalScopeLabel", () => {
  it("names private, the workspace and the organization with their level", () => {
    expect(generalScopeLabel(key, { kind: "restricted", level: null })).toBe("documents.accessReport.scope_private");
    expect(generalScopeLabel(key, { kind: "workspace", level: "edit" })).toBe(
      'documents.accessReport.scope_workspace_level{"level":"documents.accessReport.level_edit"}',
    );
    expect(generalScopeLabel(key, { kind: "organization", level: "view" })).toBe(
      'documents.accessReport.scope_organization_level{"level":"documents.accessReport.level_view"}',
    );
  });

  it("reads an unknown scope as Other", () => {
    expect(generalScopeLabel(key, { kind: "galaxy", level: null })).toBe("documents.accessReport.visibility_other");
  });
});

describe("flagLabel", () => {
  it("names every warning flag", () => {
    expect(flagLabel(key, "public_link")).toBe("documents.accessReport.flag_public_link");
    expect(flagLabel(key, "other_workspace")).toBe("documents.accessReport.flag_other_workspace");
    expect(flagLabel(key, "organization")).toBe("documents.accessReport.flag_organization");
    expect(flagLabel(key, "direct_manage")).toBe("documents.accessReport.flag_direct_manage");
  });
});

describe("whoSummary", () => {
  const none = { people: 0, links: 0, otherWorkspaces: 0, workspaceWide: false, organizationWide: false };

  it("counts people and links: '3 people · 1 link'", () => {
    expect(whoSummary(key, { ...none, people: 3, links: 1 })).toBe(
      'documents.accessReport.who_people{"count":3} · documents.accessReport.who_links{"count":1}',
    );
  });

  it("names the organization, the whole workspace and other workspaces before people", () => {
    expect(whoSummary(key, { people: 1, links: 0, otherWorkspaces: 1, workspaceWide: true, organizationWide: true })).toBe(
      [
        "documents.accessReport.who_organization",
        "documents.accessReport.who_workspace",
        'documents.accessReport.who_other_workspaces{"count":1}',
        'documents.accessReport.who_people{"count":1}',
      ].join(" · "),
    );
  });

  it("is empty when nobody has access", () => {
    expect(whoSummary(key, none)).toBe("");
  });
});

describe("grantKindNote", () => {
  it("marks the viewer, the home workspace, another workspace, the organization and a link", () => {
    expect(grantKindNote(key, row({ principal_id: "me" }), WS, "me")).toBe("documents.accessReport.you");
    expect(grantKindNote(key, row({ principal_id: "u2" }), WS, "me")).toBe("");
    expect(grantKindNote(key, row({ principal_type: "workspace", principal_id: WS }), WS, "me")).toBe(
      "documents.share.principal_workspace",
    );
    expect(grantKindNote(key, row({ principal_type: "workspace", principal_id: "ws9" }), WS, "me")).toBe(
      "documents.accessReport.kind_other_workspace",
    );
    expect(grantKindNote(key, row({ principal_type: "organization" }), WS, "me")).toBe(
      "documents.accessReport.kind_organization",
    );
    expect(grantKindNote(key, row({ principal_type: "link" }), WS, "me")).toBe("documents.accessReport.kind_link");
    expect(grantKindNote(key, row({ principal_type: "robot" }), WS, "me")).toBe("documents.accessReport.principal_other");
  });
});
