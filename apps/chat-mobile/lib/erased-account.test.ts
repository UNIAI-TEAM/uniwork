import { describe, expect, it } from "vitest";
import { ERASED_ACCOUNT_NAME, relabelErasedAccounts } from "./erased-account";

describe("relabelErasedAccounts", () => {
  it("reads an erased account's name in the app's language wherever a name field holds it", () => {
    const answer = {
      messages: [
        { id: "m1", sender_display_name: ERASED_ACCOUNT_NAME, body: ERASED_ACCOUNT_NAME },
        { id: "m2", sender_display_name: "Bình" },
      ],
      room: { peer_display_name: ERASED_ACCOUNT_NAME, members: [{ display_name: ERASED_ACCOUNT_NAME }] },
    };
    expect(relabelErasedAccounts(answer, "Deleted user")).toEqual({
      messages: [
        // Only name fields: a message that quotes the words stays as written.
        { id: "m1", sender_display_name: "Deleted user", body: ERASED_ACCOUNT_NAME },
        { id: "m2", sender_display_name: "Bình" },
      ],
      room: { peer_display_name: "Deleted user", members: [{ display_name: "Deleted user" }] },
    });
    // The input is never written to.
    expect(answer.messages[0]?.sender_display_name).toBe(ERASED_ACCOUNT_NAME);
  });

  it("hands back the same value when nothing names an erased account", () => {
    const answer = { messages: [{ sender_display_name: "An" }], total: 1, next: null };
    expect(relabelErasedAccounts(answer, "Deleted user")).toBe(answer);
    expect(relabelErasedAccounts("text", "Deleted user")).toBe("text");
    expect(relabelErasedAccounts(null, "Deleted user")).toBeNull();
  });
});
