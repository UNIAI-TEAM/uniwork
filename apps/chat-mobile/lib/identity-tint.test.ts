import { describe, expect, it } from "vitest";
import { IDENTITY_TINTS, identityTint } from "./identity-tint";

describe("identityTint", () => {
  it("gives an id the same tint every time, from the mobile set", () => {
    expect(identityTint("01J9ROOM")).toBe(identityTint("01J9ROOM"));
    expect(IDENTITY_TINTS).toContain(identityTint(""));
  });

  it("spreads ids over every tint", () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => identityTint(`room-${i}`)));
    expect(seen.size).toBe(IDENTITY_TINTS.length);
  });
});
