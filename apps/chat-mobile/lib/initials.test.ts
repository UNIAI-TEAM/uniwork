// The cases of packages/views/chat/chat-initials.ts' doc comments, which the canvas draws.
import { describe, expect, it } from "vitest";
import { initialOf, initialsOf, roomInitialsOf, shortNameOf } from "./initials";

describe("initials", () => {
  it("takes a person's last two words", () => {
    expect(initialsOf("Nguyễn Thu Hà")).toBe("TH");
    expect(initialsOf("Trần Đức Anh")).toBe("ĐA");
    expect(initialsOf("Hà")).toBe("H");
    expect(initialsOf("   ")).toBe("?");
  });

  it("shortens a name to its last two words for the presence strip", () => {
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
    expect(initialOf("")).toBe("?");
    // A name still loading must not break the face.
    expect(roomInitialsOf(undefined)).toBe("?");
    expect(initialsOf(null)).toBe("?");
  });
});
