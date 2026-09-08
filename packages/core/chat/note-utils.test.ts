import { describe, expect, it } from "vitest";
import { canSubmitNote, NOTE_BODY_MAX_LENGTH } from "./note-utils";

describe("note-utils", () => {
  it("accepts non-empty trimmed body within max length", () => {
    expect(canSubmitNote("  Link tài liệu  ")).toBe(true);
  });

  it("rejects empty body", () => {
    expect(canSubmitNote("   ")).toBe(false);
  });

  it("rejects body over max length", () => {
    expect(canSubmitNote("x".repeat(NOTE_BODY_MAX_LENGTH + 1))).toBe(false);
  });
});
