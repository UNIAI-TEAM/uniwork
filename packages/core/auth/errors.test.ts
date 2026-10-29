import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { ownedOrganization } from "./errors";

const refusal = (fields?: Record<string, unknown>) => new ApiError("x", "owner_must_transfer", 409, undefined, fields);

describe("ownedOrganization", () => {
  it("names the organization a deletion was refused for, and whether it closes with the erasure", () => {
    expect(ownedOrganization(refusal({ organization_name: "Acme", organization_slug: "acme", can_close: true }))).toEqual({
      name: "Acme",
      slug: "acme",
      canClose: true,
    });
    expect(ownedOrganization(refusal({ organization_name: "Acme", organization_slug: "acme", can_close: false }))).toEqual({
      name: "Acme",
      slug: "acme",
      canClose: false,
    });
  });

  it("reads drifted fields as an organization with nothing to close", () => {
    expect(ownedOrganization(refusal())).toEqual({ name: "", slug: "", canClose: false });
    // can_close without a slug to type back cannot close anything.
    expect(ownedOrganization(refusal({ organization_name: "Acme", can_close: true }))).toEqual({
      name: "Acme",
      slug: "",
      canClose: false,
    });
    expect(ownedOrganization(refusal({ organization_slug: " acme ", can_close: "yes" }))).toEqual({
      name: "acme",
      slug: "acme",
      canClose: false,
    });
  });

  it("is null for any other failure", () => {
    expect(ownedOrganization(new ApiError("x", "proof_required", 403))).toBeNull();
    expect(ownedOrganization(new ApiError("x", "organization_has_members", 409))).toBeNull();
    expect(ownedOrganization(new Error("x"))).toBeNull();
    expect(ownedOrganization(undefined)).toBeNull();
  });
});
