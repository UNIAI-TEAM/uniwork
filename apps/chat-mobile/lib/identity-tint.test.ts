import { describe, expect, it } from "vitest";
import { IDENTITY_TINTS, identityTint } from "./identity-tint";

describe("identityTint", () => {
  it("hashes as the web does (packages/views/people/identity-tint.ts)", () => {
    // The web's seven tints in its order: a hash lands on the same slot on both.
    expect(IDENTITY_TINTS).toEqual(["violet", "blue", "pink", "orange", "green", "yellow", "teal"]);
    let hash = 0;
    for (const ch of "01J9ROOM") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    expect(identityTint("01J9ROOM")).toBe(IDENTITY_TINTS[hash % 7]);
  });

  it("gives an id the same tint every time, from the mobile set", () => {
    expect(identityTint("01J9ROOM")).toBe(identityTint("01J9ROOM"));
    expect(IDENTITY_TINTS).toContain(identityTint(""));
  });

  it("spreads ids over every tint", () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => identityTint(`room-${i}`)));
    expect(seen.size).toBe(IDENTITY_TINTS.length);
  });
});
