import { describe, expect, it } from "vitest";
import { isComposerMessagePriority, toggleComposerPriority } from "./composer-priority";

describe("composer-priority", () => {
  it("activates a priority flag when none is set", () => {
    expect(toggleComposerPriority(null, "important")).toBe("important");
  });

  it("switches between important and urgent", () => {
    expect(toggleComposerPriority("important", "urgent")).toBe("urgent");
  });

  it("clears when the same flag is toggled again", () => {
    expect(toggleComposerPriority("urgent", "urgent")).toBeNull();
  });

  it("recognizes important as a composer priority", () => {
    expect(isComposerMessagePriority("important")).toBe(true);
  });

  it("recognizes urgent as a composer priority", () => {
    expect(isComposerMessagePriority("urgent")).toBe(true);
  });

  it("rejects other strings as composer priorities", () => {
    expect(isComposerMessagePriority("normal")).toBe(false);
  });

  it("rejects empty string as a composer priority", () => {
    expect(isComposerMessagePriority("")).toBe(false);
  });
});
