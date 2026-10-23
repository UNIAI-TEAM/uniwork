import { IDENTITY_TINTS } from "@uniwork/core/chat/identity-tint";
import { describe, expect, it } from "vitest";
import { SOLID_TINT_BG } from "./identity-tint";

describe("SOLID_TINT_BG", () => {
  it("names the solid tint class of every identity tint core hashes onto", () => {
    expect(Object.keys(SOLID_TINT_BG).sort()).toEqual([...IDENTITY_TINTS].sort());
    for (const tint of IDENTITY_TINTS) expect(SOLID_TINT_BG[tint]).toBe(`bg-tint-${tint}-solid`);
  });
});
