import { beforeEach, describe, expect, it } from "vitest";
import {
  dedupeGroupChats,
  findGroupByMemberSet,
  listGroupChats,
  memberSetKey,
  removeGroupChat,
  resetGroupChatsForTests,
  upsertGroupChat,
} from "./groups-store";

const USER = "01M14FBNCQ6BDQB5TRKJX35ESG";

describe("groups-store", () => {
  beforeEach(() => {
    resetGroupChatsForTests(USER);
  });

  it("sorts member set keys regardless of input order", () => {
    expect(memberSetKey(["B", "A"])).toBe(memberSetKey(["a", "b"]));
  });

  it("upserts by room id and uses room id as canonical id", () => {
    upsertGroupChat(USER, {
      id: "g1",
      name: "Alpha",
      room_id: "!a:localhost",
      member_user_ids: ["01AAA", "01BBB"],
    });
    upsertGroupChat(USER, {
      id: "legacy-ulid",
      name: "Beta",
      room_id: "!a:localhost",
      member_user_ids: ["01AAA", "01BBB", "01CCC"],
    });
    const groups = listGroupChats(USER);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("!a:localhost");
    expect(groups[0]?.name).toBe("Beta");
    expect(groups[0]?.member_user_ids).toEqual(["01AAA", "01BBB", "01CCC"]);
  });

  it("finds group by member set", () => {
    upsertGroupChat(USER, {
      id: "g1",
      name: "Team",
      room_id: "!room:localhost",
      member_user_ids: ["01AAA", "01BBB"],
    });
    expect(findGroupByMemberSet(USER, ["01BBB", "01AAA"])?.room_id).toBe("!room:localhost");
  });

  it("removes group by id or room id", () => {
    upsertGroupChat(USER, {
      id: "g1",
      name: "Team",
      room_id: "!room:localhost",
      member_user_ids: ["01AAA"],
    });
    removeGroupChat(USER, "!room:localhost");
    expect(listGroupChats(USER)).toHaveLength(0);

    upsertGroupChat(USER, {
      id: "!room2:localhost",
      name: "Other",
      room_id: "!room2:localhost",
      member_user_ids: ["01BBB"],
    });
    removeGroupChat(USER, "!room2:localhost");
    expect(listGroupChats(USER)).toHaveLength(0);
  });

  it("dedupes legacy ulid id and native room id rows", () => {
    upsertGroupChat(USER, {
      id: "01LEGACY",
      name: "hehe",
      room_id: "!room:localhost",
      member_user_ids: ["01AAA", "01BBB"],
    });
    upsertGroupChat(USER, {
      id: "!room:localhost",
      name: "hehe",
      room_id: "!room:localhost",
      member_user_ids: ["01AAA"],
    });
    const groups = dedupeGroupChats(USER);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("!room:localhost");
    expect(groups[0]?.member_user_ids).toEqual(["01AAA", "01BBB"]);
  });
});
