import { describe, expect, it } from "vitest";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { buildChatNameContext, chatHeaderTitle } from "./chat-page-utils";

const contact = (user_id: string, display_name: string, email: string): ChatContact => ({
  user_id,
  display_name,
  email,
  dm_room_id: null,
});

describe("buildChatNameContext", () => {
  it("includes workspace members for sender labels", () => {
    const context = buildChatNameContext(
      [],
      null,
      null,
      {},
      [{ user_id: "u1", display_name: "Tran Hoang Long", email: "long@example.com" }],
    );

    expect(context).toEqual([{ user_id: "u1", display_name: "Tran Hoang Long" }]);
  });

  it("prefers contact labels over workspace member entries", () => {
    const contacts = [contact("u1", "Long (DM)", "long@example.com")];
    const context = buildChatNameContext(
      contacts,
      null,
      null,
      {},
      [{ user_id: "u1", display_name: "Tran Hoang Long", email: "long@example.com" }],
    );

    expect(context).toEqual([{ user_id: "u1", display_name: "Long (DM)" }]);
  });

  it("prefers nickname over contact display name", () => {
    const contacts = [contact("u1", "Tran Hoang Long", "long@example.com")];
    const context = buildChatNameContext(
      contacts,
      null,
      null,
      {},
      [],
      { u1: "Long bạn thân" },
    );

    expect(context).toEqual([{ user_id: "u1", display_name: "Long bạn thân" }]);
  });

  it("falls back to email local part when workspace display name is empty", () => {
    const context = buildChatNameContext(
      [],
      null,
      null,
      {},
      [{ user_id: "u2", display_name: "  ", email: "alice@example.com" }],
    );

    expect(context).toEqual([{ user_id: "u2", display_name: "alice" }]);
  });

  it("includes active group member profiles", () => {
    const group: GroupChat = {
      id: "g1",
      name: "hehe",
      room_id: "r1",
      member_user_ids: ["u3"],
    };
    const context = buildChatNameContext(
      [],
      null,
      group,
      {
        u3: { user_id: "u3", display_name: "Bob", email: "bob@example.com" },
      },
      [],
    );

    expect(context).toEqual([{ user_id: "u3", display_name: "Bob" }]);
  });

  it("resolves group members from contacts and nicknames when profile missing", () => {
    const group: GroupChat = {
      id: "g1",
      name: "hehe",
      room_id: "r1",
      member_user_ids: ["u4", "u5", "u4"],
    };
    const contacts = [contact("u4", "Four", "four@example.com")];
    const context = buildChatNameContext(contacts, null, group, {}, [], {
      u4: "Tư",
    });
    expect(context).toEqual([{ user_id: "u4", display_name: "Tư" }]);

    const withProfileNick = buildChatNameContext(
      [],
      null,
      { ...group, member_user_ids: ["u6"] },
      { u6: { user_id: "u6", display_name: "Six", email: "six@example.com" } },
      [],
      { u6: "Sáu" },
    );
    expect(withProfileNick).toEqual([{ user_id: "u6", display_name: "Sáu" }]);
  });

  it("includes active contact and falls back to user_id for blank workspace labels", () => {
    const active = contact("u9", "Active", "a@x.com");
    const context = buildChatNameContext(
      [],
      active,
      null,
      {},
      [{ user_id: "u10", display_name: "  ", email: "  " }],
    );
    expect(context).toEqual([
      { user_id: "u9", display_name: "Active" },
      { user_id: "u10", display_name: "u10" },
    ]);
  });
});

describe("chatHeaderTitle", () => {
  it("returns workspace title for workspace target", () => {
    expect(
      chatHeaderTitle({ kind: "workspace" }, [], [], "General", ({ name }) => name),
    ).toBe("General");
  });

  it("returns group name from sidebar list when available", () => {
    const group: GroupChat = { id: "g1", name: "Team", room_id: "r1", member_user_ids: [] };
    expect(
      chatHeaderTitle({ kind: "group", group }, [], [group], "General", ({ name }) => name),
    ).toBe("Team");
  });

  it("falls back to target group name when sidebar list misses it", () => {
    const group: GroupChat = { id: "g1", name: "Local", room_id: "r1", member_user_ids: [] };
    expect(
      chatHeaderTitle({ kind: "group", group }, [], [], "General", ({ name }) => name),
    ).toBe("Local");
  });

  it("formats dm header with contact label", () => {
    const dm = contact("u1", "Long", "long@example.com");
    expect(
      chatHeaderTitle({ kind: "dm", contact: dm }, [dm], [], "General", ({ name }) => `Chat with ${name}`),
    ).toBe("Chat with Long");
  });

  it("formats dm header with nickname when set", () => {
    const dm = contact("u1", "Tran Hoang Long", "long@example.com");
    expect(
      chatHeaderTitle(
        { kind: "dm", contact: dm },
        [dm],
        [],
        "General",
        ({ name }) => `Chat with ${name}`,
        { u1: "Long" },
      ),
    ).toBe("Chat with Long");
  });

  it("formats dm from target contact when contacts list misses them", () => {
    const dm = contact("u1", "Solo", "solo@example.com");
    expect(
      chatHeaderTitle(
        { kind: "dm", contact: dm },
        [],
        [],
        "General",
        ({ name }) => `Chat with ${name}`,
      ),
    ).toBe("Chat with Solo");
  });
});
