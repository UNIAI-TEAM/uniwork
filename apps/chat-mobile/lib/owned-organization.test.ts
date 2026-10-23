import { describe, expect, it } from "vitest";
import {
  CLOSE_ORGANIZATION_HANDLED_CODES,
  closeConfirmed,
  closeFailure,
  closeOrganizationBody,
  ownedOrganization,
} from "./owned-organization";

const refusal = (code: string, status = 403) => ({ status, body: { error: { code, message: "x" } } });

describe("ownedOrganization (owner_must_transfer's fields)", () => {
  const owner = (fields: unknown) => ({ status: 409, body: { error: { code: "owner_must_transfer", fields } } });

  it("reads the organization and whether the owner may close it", () => {
    expect(ownedOrganization(owner({ organization_name: "Một mình", organization_slug: "mot-minh", can_close: true }))).toEqual({
      name: "Một mình",
      slug: "mot-minh",
      canClose: true,
    });
    expect(ownedOrganization(owner({ organization_name: "Acme", organization_slug: "acme", can_close: false }))?.canClose).toBe(false);
    // A drifted can_close is no close; a missing name reads as the slug.
    expect(ownedOrganization(owner({ organization_slug: "acme", can_close: "yes" }))).toEqual({ name: "acme", slug: "acme", canClose: false });
  });

  it("is null for an older server's bare refusal, a drifted slug, or another failure", () => {
    expect(ownedOrganization(refusal("owner_must_transfer", 409))).toBeNull();
    expect(ownedOrganization(owner({ organization_slug: 7 }))).toBeNull();
    expect(ownedOrganization(owner({ organization_slug: "" }))).toBeNull();
    expect(ownedOrganization(refusal("password_incorrect"))).toBeNull();
  });
});

describe("closeConfirmed", () => {
  it("accepts the slug typed in any case with stray spaces, and nothing else", () => {
    const organization = { name: "Một mình", slug: "mot-minh", canClose: true };
    expect(closeConfirmed(" Mot-Minh ", organization)).toBe(true);
    expect(closeConfirmed("Một mình", organization)).toBe(false);
    expect(closeConfirmed("", organization)).toBe(false);
  });
});

describe("closeOrganizationBody", () => {
  it("names the organization to close, trimmed, and nothing for a blank or absent one", () => {
    expect(closeOrganizationBody(" mot-minh ")).toEqual({ close_organization: "mot-minh" });
    expect(closeOrganizationBody("  ")).toEqual({});
    expect(closeOrganizationBody(undefined)).toEqual({});
  });
});

describe("closeFailure", () => {
  it("tells a mistyped organization and one that gained a member apart", () => {
    expect(closeFailure(refusal("close_confirm_mismatch", 400))).toBe("close_mismatch");
    expect(closeFailure(refusal("organization_has_members", 409))).toBe("organization_has_members");
  });

  it("is null for any other failure", () => {
    expect(closeFailure(refusal("password_incorrect"))).toBeNull();
    expect(closeFailure({ status: 0 })).toBeNull();
    expect(closeFailure(null)).toBeNull();
  });

  it("declares every code it explains as handled, and only those", () => {
    for (const code of CLOSE_ORGANIZATION_HANDLED_CODES) expect(closeFailure(refusal(code)), code).not.toBeNull();
  });
});
