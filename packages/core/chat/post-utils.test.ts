import { describe, expect, it } from "vitest";
import { canSubmitPost, POST_BODY_MAX_LENGTH, POST_TITLE_MAX_LENGTH } from "./post-utils";

describe("post-utils", () => {
  it("requires non-empty title and body within limits", () => {
    expect(canSubmitPost("", "body")).toBe(false);
    expect(canSubmitPost("title", "")).toBe(false);
    expect(canSubmitPost("  Hi  ", "  Body  ")).toBe(true);
    expect(canSubmitPost("t".repeat(POST_TITLE_MAX_LENGTH + 1), "ok")).toBe(false);
    expect(canSubmitPost("ok", "b".repeat(POST_BODY_MAX_LENGTH + 1))).toBe(false);
  });
});
