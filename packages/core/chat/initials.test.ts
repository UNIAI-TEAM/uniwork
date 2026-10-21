// The cases of the doc comments in initials.ts, which the canvas draws.
import { describe, expect, it } from "vitest";
import { givenNameOf, initialOf, initialsOf, roomInitialsOf, shortNameOf } from "./initials";

describe("initials", () => {
  it("takes a person's last two words", () => {
    expect(initialsOf("Nguyễn Thu Hà")).toBe("TH");
    expect(initialsOf("Trần Đức Anh")).toBe("ĐA");
    expect(initialsOf("Hà")).toBe("H");
    expect(initialsOf("   ")).toBe("?");
  });

  it("shortens a name to its last two words for a narrow strip", () => {
    expect(shortNameOf("Nguyễn Thu Hà")).toBe("Thu Hà");
    expect(shortNameOf("Võ Minh")).toBe("Võ Minh");
    expect(shortNameOf(undefined)).toBe("");
  });

  it("takes a room's first two words and skips a leading Đội", () => {
    expect(roomInitialsOf("Ra mắt UniWork Q4")).toBe("RM");
    expect(roomInitialsOf("Đội Thiết kế")).toBe("TK");
    expect(roomInitialsOf("Đội Nội dung")).toBe("ND");
    expect(roomInitialsOf("Truyền thông")).toBe("TT");
    expect(roomInitialsOf("UNICOM")).toBe("U");
    // One code point per word, so an emoji is never cut in half.
    expect(roomInitialsOf("🚀 Ra mắt")).toBe("🚀R");
    expect(initialsOf("Lan 😀")).toBe("L😀");
    expect(initialOf("")).toBe("?");
    // A name still loading must not break the face.
    expect(roomInitialsOf(undefined)).toBe("?");
    expect(initialsOf(null)).toBe("?");
    expect(initialOf(null)).toBe("?");
  });

  it("names a person in a busy line by the given name, unless the last word is an acronym", () => {
    expect(givenNameOf("Bùi Minh Quân")).toBe("Quân");
    expect(givenNameOf(" Phòng HC ")).toBe("Phòng HC");
    expect(givenNameOf("Quân")).toBe("Quân");
    expect(givenNameOf("   ")).toBe("");
  });
});
