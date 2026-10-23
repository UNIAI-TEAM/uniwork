// Parity: the senderLabelFor cases of packages/views/chat/native-chat-message-mapping.test.ts.
import { describe, expect, it } from "vitest";
import { buildChatNameContext, senderLabelFor } from "./people-display";

describe("senderLabelFor", () => {
  const message = { sender: "u1" };

  it("returns youLabel for the current user", () => {
    expect(senderLabelFor(message, "u1", "Bạn", [])).toBe("Bạn");
  });

  it("uses name context and falls back to sender id", () => {
    expect(senderLabelFor(message, "other", "Bạn", [{ user_id: "u1", display_name: "  An  " }])).toBe("An");
    expect(senderLabelFor(message, "other", "Bạn", [{ user_id: "u1", display_name: "  " }])).toBe("u1");
    expect(senderLabelFor(message, "other", "Bạn", [])).toBe("u1");
    expect(senderLabelFor(message, "other", "Bạn", [{ user_id: "U1", display_name: "An" }])).toBe("An");
    expect(
      senderLabelFor(message, "other", "Bạn", [{ user_id: "u1", display_name: "u1", email: "tramyd@example.com" }]),
    ).toBe("tramyd");
    expect(senderLabelFor(message, "other", "Bạn", [{ user_id: "u1", display_name: "u1", email: "u1@x.vn" }])).toBe("u1");
  });
});

describe("buildChatNameContext", () => {
  it("lists contacts, room members then workspace members once each, with nicknames first", () => {
    const context = buildChatNameContext(
      [{ user_id: "u1", email: "an@x.vn", display_name: "An", dm_room_id: "dm1" }],
      [{ user_id: "U1", email: "", display_name: "dup" }, { user_id: "u2", email: "binh@x.vn", display_name: "Bình" }],
      [{ user_id: "u3", email: "chi@x.vn", display_name: "Chi" }, { user_id: " ", email: "", display_name: "ghost" }],
      { u3: "Chị Ba" },
    );
    expect(context).toEqual([
      { user_id: "u1", display_name: "An", email: "an@x.vn" },
      { user_id: "u2", display_name: "Bình", email: "binh@x.vn" },
      { user_id: "u3", display_name: "Chị Ba", email: "chi@x.vn" },
    ]);
  });
});
