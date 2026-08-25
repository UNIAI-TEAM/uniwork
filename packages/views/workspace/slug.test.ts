import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { isSlugConflict, nameToSlug, randomWorkspaceIdentity, SLUG_REGEX } from "./slug";

describe("slug helpers", () => {
  it("nameToSlug strips diacritics, returns empty for CJK/emoji", () => {
    expect(nameToSlug("Đội Alpha 1")).toBe("doi-alpha-1");
    expect(nameToSlug("日本語")).toBe("");
    expect(nameToSlug("🎉")).toBe("");
  });
  it("random identity has valid slug with 4-char suffix", () => {
    const id = randomWorkspaceIdentity(() => 0.5);
    expect(id.name.length).toBeGreaterThan(0);
    expect(SLUG_REGEX.test(id.slug)).toBe(true);
    expect(id.slug).toMatch(/-[a-z0-9]{4}$/);
  });
  it("isSlugConflict keys on 409", () => {
    expect(isSlugConflict(new ApiError("x", "conflict", 409))).toBe(true);
    expect(isSlugConflict(new ApiError("x", "internal", 500))).toBe(false);
    expect(isSlugConflict(new Error("x"))).toBe(false);
  });
});
