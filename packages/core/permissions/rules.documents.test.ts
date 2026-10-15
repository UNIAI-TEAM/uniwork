import { describe, expect, it } from "vitest";
import {
  canCommentDocument,
  canEditDocument,
  canManageDocument,
  canViewDocument,
  documentLevelRank,
} from "./rules";
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
  ["comment", canCommentDocument, 2],
  ["edit", canEditDocument, 3],
  ["manage", canManageDocument, 4],
] as const;

const levels = ["view", "comment", "edit", "manage"] as const;

describe("document rules — mirror effectiveLevel (document_permissions.go)", () => {
  it("ranks view < comment < edit < manage and treats unknown levels as rank 0 deny (DOC5-W04)", () => {
    expect(documentLevelRank("view")).toBe(1);
    expect(documentLevelRank("comment")).toBe(2);
    expect(documentLevelRank("edit")).toBe(3);
    expect(documentLevelRank("manage")).toBe(4);
    for (const unknown of [undefined, null, "", "none", "owner", "admin", "break_glass", "COMMENT"]) {
      expect(documentLevelRank(unknown)).toBe(0);
    }
  });

  for (const [name, rule, required] of rules) {
    it(`${name}: allowed exactly from its level upward`, () => {
      levels.forEach((level, i) => {
        const d = rule({ my_level: level }, ctx());
        expect(d.allowed).toBe(i + 1 >= required);
        if (!d.allowed) expect(d.reason).toBe("insufficient_level");
      });
    });

    it(`${name}: no level or unknown level is not found, never a hint (DOC5-W04)`, () => {
      for (const doc of [
        null,
        {},
        { my_level: null },
        { my_level: "" },
        { my_level: "owner" },
        { my_level: "admin" },
        { my_level: "super_edit" },
      ]) {
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

  it("comment level allows viewing and commenting but denies editing and managing", () => {
    const member = ctx();
    expect(canViewDocument({ my_level: "comment" }, member).allowed).toBe(true);
    expect(canCommentDocument({ my_level: "comment" }, member).allowed).toBe(true);
    expect(canEditDocument({ my_level: "comment" }, member)).toMatchObject({
      allowed: false,
      reason: "insufficient_level",
    });
    expect(canManageDocument({ my_level: "comment" }, member)).toMatchObject({
      allowed: false,
      reason: "insufficient_level",
    });
  });

  it("workspace role alone grants nothing: the server level decides (owned/restricted documents)", () => {
    // An org owner on a work-product-owned or restricted document without read access has
    // my_level none/empty on the server; the client must not upgrade it.
    const admin = ctx({ orgRole: "owner", wsRole: "admin" });
    expect(canViewDocument({ my_level: null }, admin).allowed).toBe(false);
    expect(canViewDocument({ my_level: "" }, admin).allowed).toBe(false);
    expect(canCommentDocument({ my_level: "view" }, admin).allowed).toBe(false);
    expect(canManageDocument({ my_level: "view" }, admin).allowed).toBe(false);
  });
});
