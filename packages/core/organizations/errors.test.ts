import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { alreadyInOrganization, organizationSwitchConflicts } from "./errors";

const apiError = (code: string, fields?: Record<string, unknown>) =>
  new ApiError("refused", code, 409, undefined, fields);

describe("alreadyInOrganization", () => {
  it("reads the organization the caller already belongs to", () => {
    const err = apiError("already_in_organization", { organization: { id: "o1", name: "Acme", slug: "acme" } });
    expect(alreadyInOrganization(err)).toEqual({ id: "o1", name: "Acme", slug: "acme" });
  });

  it("is null for another code, a non-ApiError, or drifted fields", () => {
    expect(alreadyInOrganization(apiError("conflict", { organization: { id: "o1", name: "A", slug: "a" } }))).toBeNull();
    expect(alreadyInOrganization(new Error("x"))).toBeNull();
    expect(alreadyInOrganization(apiError("already_in_organization", { organization: { id: 1 } }))).toBeNull();
    expect(alreadyInOrganization(apiError("already_in_organization"))).toBeNull();
  });
});

describe("organizationSwitchConflicts", () => {
  const conflict = {
    organization: { id: "o1", name: "Acme", slug: "acme" },
    role: "owner",
    required_action: "transfer",
    transfer_candidates_count: 2,
  };

  it("reads the conflicts a 409 organization_switch_required carries", () => {
    const err = apiError("organization_switch_required", {
      conflicts: [conflict, { ...conflict, required_action: "blocked", blocked_reason: "owner_of_suspended_organization" }],
    });
    const out = organizationSwitchConflicts(err);
    expect(out).toHaveLength(2);
    expect(out?.[0]).toMatchObject({ required_action: "transfer", transfer_candidates_count: 2 });
    expect(out?.[1]?.blocked_reason).toBe("owner_of_suspended_organization");
  });

  it("keeps an unknown action and defaults a missing count", () => {
    const { transfer_candidates_count: _drop, ...rest } = conflict;
    const out = organizationSwitchConflicts(
      apiError("organization_switch_required", { conflicts: [{ ...rest, required_action: "later" }] }),
    );
    expect(out?.[0]).toMatchObject({ required_action: "later", transfer_candidates_count: 0 });
  });

  it("is null for another code or drifted fields", () => {
    expect(organizationSwitchConflicts(apiError("conflict", { conflicts: [conflict] }))).toBeNull();
    expect(organizationSwitchConflicts(apiError("organization_switch_required", { conflicts: "x" }))).toBeNull();
    expect(organizationSwitchConflicts(new Error("x"))).toBeNull();
  });
});
