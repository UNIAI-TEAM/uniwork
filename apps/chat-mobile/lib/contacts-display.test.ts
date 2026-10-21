import { describe, expect, it } from "vitest";
import { contactLabel, contactSections, pickerPeople } from "./contacts-display";
import { resolveChatNicknameForUser } from "@uniwork/core/chat/contact-labels";

const member = (user_id: string, display_name: string, email = `${user_id}@example.com`) => ({ user_id, display_name, email });

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

describe("pickerPeople", () => {
  it("leaves the reader out, labels and finds people as the chat names them, A–Z", () => {
    const people = [member("ME", "Tôi"), member("u2", "Trần Bình"), member("u3", "An Nguyễn", "an@x.vn"), member("u4", "Cường")];
    expect(pickerPeople(people, { currentUserId: "me", nicknames: { U4: "Anh Cả" }, query: "" }).map((p) => p.label)).toEqual(["An Nguyễn", "Anh Cả", "Trần Bình"]);
    expect(pickerPeople(people, { currentUserId: "me", query: "binh" }).map((p) => p.user_id)).toEqual(["u2"]);
    expect(pickerPeople(people, { currentUserId: "me", query: "an@x" }).map((p) => p.user_id)).toEqual(["u3"]);
  });
});
