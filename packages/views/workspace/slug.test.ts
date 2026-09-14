import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { isSlugConflict, isSlugLengthValid, nameToSlug, randomWorkspaceIdentity, SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, SLUG_REGEX } from "./slug";

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
  // Mirrors ValidateSlug in server/internal/service/slug.go: outside 2-40 the
  // server answers 400 and its raw Vietnamese message leaks to the user.
  it("isSlugLengthValid mirrors the server's 2-40 bound", () => {
    expect(SLUG_MIN_LENGTH).toBe(2);
    expect(SLUG_MAX_LENGTH).toBe(40);
    expect(isSlugLengthValid("")).toBe(false);
    expect(isSlugLengthValid("a")).toBe(false);
    expect(isSlugLengthValid("ab")).toBe(true);
    expect(isSlugLengthValid("a".repeat(SLUG_MAX_LENGTH))).toBe(true);
    expect(isSlugLengthValid("a".repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });
  it("both length failures are reachable from real names through nameToSlug", () => {
    expect(nameToSlug("A")).toBe("a");
    expect(isSlugLengthValid(nameToSlug("A"))).toBe(false);
    const long = nameToSlug("Công ty Cổ phần Thương mại Dịch vụ Xuất nhập khẩu Việt Nam");
    expect(long.length).toBeGreaterThan(SLUG_MAX_LENGTH);
    expect(SLUG_REGEX.test(long)).toBe(true); // format is fine, only length is not
    expect(isSlugLengthValid(long)).toBe(false);
  });
  it("a random identity always satisfies the length rule", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(isSlugLengthValid(randomWorkspaceIdentity(() => r).slug)).toBe(true);
    }
  });
  it("isSlugConflict keys on 409", () => {
    expect(isSlugConflict(new ApiError("x", "conflict", 409))).toBe(true);
    expect(isSlugConflict(new ApiError("x", "internal", 500))).toBe(false);
    expect(isSlugConflict(new Error("x"))).toBe(false);
  });
});
