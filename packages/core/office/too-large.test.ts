import { describe, expect, it } from "vitest";
import { isOfficeTooLarge } from "./too-large";

describe("isOfficeTooLarge", () => {
  it("recognises every typed too-large signal the web receives", () => {
    expect(isOfficeTooLarge({ code: "upload_bounds" })).toBe(true);
    expect(isOfficeTooLarge({ code: "engine_result_invalid", kind: "byte_bound" })).toBe(true);
    expect(isOfficeTooLarge({ code: "file_too_large" })).toBe(true);
    expect(isOfficeTooLarge({ failure_class: "too_large" })).toBe(true);
    expect(isOfficeTooLarge({ failureClass: "too_large" })).toBe(true);
  });

  it("never reads a generic engine failure or a missing value as too large", () => {
    expect(isOfficeTooLarge(null)).toBe(false);
    expect(isOfficeTooLarge(undefined)).toBe(false);
    expect(isOfficeTooLarge({ code: "engine_result_invalid", kind: "malformed_result" })).toBe(false);
    expect(isOfficeTooLarge({ failure_class: "corrupted" })).toBe(false);
    expect(isOfficeTooLarge({ code: null, kind: null })).toBe(false);
  });
});
