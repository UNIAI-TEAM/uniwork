import { describe, expect, it } from "vitest";
import { contactLabel, contactSections, foldVi, foldedIncludes, resolveChatNicknameForUser } from "./contacts-display";

const member = (user_id: string, display_name: string, email = `${user_id}@example.com`) => ({ user_id, display_name, email });

// Cases copied from packages/views/chat/chat-search-fold.test.ts.
describe("foldVi / foldedIncludes (parity with chat-search-fold.ts)", () => {
  it("strips Vietnamese marks and đ, matches decomposed input, needs every word", () => {
    expect(foldVi("Nguyễn Văn Đức")).toBe("nguyen van duc");
    expect(foldedIncludes("Tuấn", "Tuấn")).toBe(true);
    expect(foldedIncludes("Trần Minh Tuấn", "tuan tran")).toBe(true);
    expect(foldedIncludes("Trần Minh Tuấn", "tuan hoa")).toBe(false);
    expect(foldedIncludes("Anything", "  ")).toBe(true);
  });
});

// Cases copied from packages/core/chat/contacts-store.test.ts (displayLabelForChatContact).
describe("contactLabel (parity with displayLabelForChatContact + memberToChatContact)", () => {
  it("falls back to email when the display name is a ULID", () => {
    const ulid = "01M14FBNCQ6BDQB5TRKJX35ESG";
    expect(contactLabel(member(ulid, ulid, "long@example.com"))).toBe("long@example.com");
  });

  it("prefers a nickname, whatever the id casing", () => {
    expect(contactLabel(member("u1", "Tran Hoang Long"), { u1: "  Long đồng nghiệp  " })).toBe("Long đồng nghiệp");
    expect(contactLabel(member("01abcdefghjk0123456789012", "Tran Hoang Long"), { "01ABCDEFGHJK0123456789012": "Long" })).toBe("Long");
  });

  it("an unnamed member reads as the local part of the email, as the web picker shows them", () => {
    expect(contactLabel(member("u3", "", "nguyen.an@example.com"))).toBe("nguyen.an");
    expect(contactLabel(member("U4", "  ", ""))).toBe("U4");
  });
});

describe("resolveChatNicknameForUser", () => {
  it("ignores blank nicknames and a missing map", () => {
    expect(resolveChatNicknameForUser(undefined, "u1")).toBeUndefined();
    expect(resolveChatNicknameForUser({ U1: "  " }, "u1")).toBeUndefined();
    expect(resolveChatNicknameForUser({ U2: "x" }, "u1")).toBeUndefined();
  });
});

describe("contactSections", () => {
  const members = [
    member("me", "Tôi"),
    member("u1", "Trần Hoang Long", "long@example.com"),
    member("u2", "Alice", "alice@example.com"),
    member("u3", "Đức Anh"),
    member("u4", "an"),
    member("u5", "007 Bot"),
    member("gone", "Người đã nghỉ"),
  ];
  const base = { currentUserId: "me", hiddenUserIds: new Set(["gone"]), query: "" };
  const shape = (sections: ReturnType<typeof contactSections>) => sections.map((s) => [s.title, s.data.map((r) => r.label)]);

  it("leaves out the viewer and hidden people, groups by folded first letter, # last", () => {
    expect(shape(contactSections(members, base))).toEqual([
      ["A", ["Alice", "an"]],
      ["D", ["Đức Anh"]],
      ["T", ["Trần Hoang Long"]],
      ["#", ["007 Bot"]],
    ]);
  });

  it("a nickname renames and re-sorts the row", () => {
    expect(shape(contactSections(members, { ...base, nicknames: { U1: "Bé Long" } }))[1]).toEqual(["B", ["Bé Long"]]);
  });

  it("finds by label, name or email without accents, like the web picker", () => {
    expect(shape(contactSections(members, { ...base, query: "duc" }))).toEqual([["D", ["Đức Anh"]]]);
    expect(shape(contactSections(members, { ...base, query: "long@" }))).toEqual([["T", ["Trần Hoang Long"]]]);
    expect(shape(contactSections(members, { ...base, nicknames: { u1: "Bé Long" }, query: "tran" }))).toEqual([["B", ["Bé Long"]]]);
    expect(contactSections(members, { ...base, query: "nghi" })).toEqual([]);
  });
});
