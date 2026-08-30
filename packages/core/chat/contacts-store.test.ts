import { describe, expect, it } from "vitest";
import {
  displayLabelForChatContact,
  isPlaceholderChatDisplayName,
  mergeChatContact,
} from "./contacts-store";

describe("mergeChatContact", () => {
  const rich = {
    user_id: "01M14FBNCQ6BDQB5TRKJX35ESG",
    email: "long@example.com",
    display_name: "Tran Hoang Long",
    matrix_user_id: "@01m14fbncq6bdqb5trkjx35esg:localhost",
    dm_room_id: "!room:localhost",
  };

  it("detects ulid placeholders", () => {
    expect(isPlaceholderChatDisplayName("01M14FBNCQ6BDQB5TRKJX35ESG", rich.user_id)).toBe(true);
    expect(isPlaceholderChatDisplayName("Tran Hoang Long", rich.user_id)).toBe(false);
  });

  it("keeps an existing display name when sync only sends the user id", () => {
    expect(
      mergeChatContact(rich, {
        ...rich,
        email: "",
        display_name: rich.user_id,
        dm_room_id: "!new:localhost",
      }),
    ).toEqual({
      ...rich,
      email: rich.email,
      display_name: "Tran Hoang Long",
      dm_room_id: "!new:localhost",
    });
  });

  it("accepts a newly resolved profile name", () => {
    expect(
      mergeChatContact(
        { ...rich, display_name: rich.user_id, email: "" },
        { ...rich, display_name: "Tran Hoang Long", email: "long@example.com" },
      ).display_name,
    ).toBe("Tran Hoang Long");
  });
});

describe("displayLabelForChatContact", () => {
  it("falls back to email when display name is a ulid", () => {
    expect(
      displayLabelForChatContact({
        user_id: "01M14FBNCQ6BDQB5TRKJX35ESG",
        display_name: "01M14FBNCQ6BDQB5TRKJX35ESG",
        email: "long@example.com",
      }),
    ).toBe("long@example.com");
  });
});
