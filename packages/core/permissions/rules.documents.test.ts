import { describe, expect, it } from "vitest";
import { canAdministerDocument, canEditDocument, canManageDocument, canViewDocument } from "./rules";
import type { PermissionContext } from "./types";

// Mirror of DocumentService.effectiveLevel + decideDocumentAccess
// (server/internal/service/document_permissions.go): the server computes
// my_level; the rules only read it.

const ctx = (over: Partial<PermissionContext> = {}): PermissionContext => ({
  userId: "u1",
  orgRole: "member",
  wsRole: null,
  orgMemberStatus: "active",
  ...over,
});

const rules = [
  ["view", canViewDocument, 1],
  ["edit", canEditDocument, 2],
  ["manage", canManageDocument, 3],
] as const;

const levels = ["view", "edit", "manage"] as const;

describe("document rules — mirror effectiveLevel (document_permissions.go)", () => {
  for (const [name, rule, required] of rules) {
    it(`${name}: allowed exactly from its level upward`, () => {
      levels.forEach((level, i) => {
        const d = rule({ my_level: level }, ctx());
        expect(d.allowed).toBe(i + 1 >= required);
        if (!d.allowed) expect(d.reason).toBe("insufficient_level");
      });
    });

    it(`${name}: no level is not found, never a hint`, () => {
      for (const doc of [null, {}, { my_level: null }, { my_level: "" }, { my_level: "owner" }]) {
        const d = rule(doc, ctx());
        expect(d.allowed).toBe(false);
        expect(d.reason).toBe("unknown");
      }
    });

    it(`${name}: deactivated member is refused before the level`, () => {
      const d = rule({ my_level: "manage" }, ctx({ orgMemberStatus: "deactivated" }));
      expect(d).toMatchObject({ allowed: false, reason: "member_deactivated" });
    });

    it(`${name}: signed out is refused`, () => {
      expect(rule({ my_level: "manage" }, ctx({ userId: null })).reason).toBe("not_authenticated");
    });
  }

  it("workspace role alone grants nothing: the server level decides (owned documents)", () => {
    // An org owner on a work-product-owned document without delegation has
    // my_level none on the server; the client must not upgrade it.
    const admin = ctx({ orgRole: "owner", wsRole: "admin" });
    expect(canViewDocument({ my_level: null }, admin).allowed).toBe(false);
    expect(canManageDocument({ my_level: "view" }, admin).allowed).toBe(false);
  });
});

// Mirror of DOC-05 access.canAdminister() = Level >= manage OR AdminScope,
// reached through withDocumentAdministerMutation (access addendum §2.1, §2.5).
describe("canAdministerDocument — mirror canAdminister() (DOC-05)", () => {
  it("manage administers; edit and view without admin_scope do not", () => {
    expect(canAdministerDocument({ my_level: "manage" }, ctx()).allowed).toBe(true);
    for (const level of ["view", "edit"]) {
      const d = canAdministerDocument({ my_level: level }, ctx());
      expect(d).toMatchObject({ allowed: false, reason: "insufficient_level" });
    }
  });

  it("admin_scope administers with no level (pure admin) and with break-glass view", () => {
    expect(canAdministerDocument({ my_level: "", admin_scope: true }, ctx()).allowed).toBe(true);
    expect(canAdministerDocument({ my_level: "view", admin_scope: true }, ctx()).allowed).toBe(true);
    expect(canAdministerDocument({ admin_scope: true }, ctx()).allowed).toBe(true);
  });

  it("no level and no admin_scope is not found", () => {
    for (const doc of [null, {}, { my_level: "" }, { my_level: "", admin_scope: false }]) {
      expect(canAdministerDocument(doc, ctx()).reason).toBe("unknown");
    }
  });

  it("deactivated and signed-out callers are refused before admin_scope", () => {
    const doc = { my_level: "manage", admin_scope: true };
    expect(canAdministerDocument(doc, ctx({ orgMemberStatus: "deactivated" })).reason).toBe("member_deactivated");
    expect(canAdministerDocument(doc, ctx({ userId: null })).reason).toBe("not_authenticated");
  });
});
