import { describe, expect, it } from "vitest";
import { identityTint } from "../people/identity-tint";
import { senderNameClass, senderQuoteClass } from "./sender-colors";

describe("sender-colors", () => {
  it("uses brand colour for own messages", () => {
    expect(senderNameClass("@me:localhost", true)).toBe("text-brand");
  });

  it("names a sender in the tint their avatar is drawn in", () => {
    const tint = identityTint("@other:localhost");
    expect(senderNameClass("@other:localhost", false)).toBe(`text-tint-${tint}-foreground`);
  });

  it("draws a reply quote in the same tint as the sender's name", () => {
    const tint = identityTint("@other:localhost");
    expect(senderQuoteClass("@other:localhost")).toBe(`border-tint-${tint}-foreground bg-tint-${tint}`);
  });
});
