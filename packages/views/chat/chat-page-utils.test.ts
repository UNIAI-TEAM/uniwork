import { describe, expect, it } from "vitest";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { buildChatNameContext } from "./chat-page-utils";

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
});
