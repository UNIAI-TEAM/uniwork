import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";

describe("chat reactions", () => {
  it("uses thumbs up as the default quick reaction", () => {
    expect(DEFAULT_QUICK_REACTION).toBe("👍");
  });
});
