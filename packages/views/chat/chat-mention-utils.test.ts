import { describe, expect, it } from "vitest";
import {
  deserializeMessageBodyToComposerDraft,
  filterMentionCandidates,
  formatAllMentionToken,
  formatComposerMentionDisplay,
  formatMemberMentionToken,
  getActiveMentionQuery,
  insertMentionToken,
  messageBodyHasMention,
  serializeComposerDraftToMessageBody,
  messageMentionsUser,
} from "./chat-mention-utils";

describe("chat-mention-utils", () => {
  it("formats member and all mention tokens", () => {
    expect(formatMemberMentionToken("Binh", "u2")).toBe("[@Binh](mention://member/u2)");
    expect(formatAllMentionToken("all")).toBe("[@all](mention://all/all)");
  });

  it("detects active mention query at cursor", () => {
    expect(getActiveMentionQuery("hello @bi", 9)).toEqual({ start: 6, query: "bi" });
    expect(getActiveMentionQuery("hello @bi world", 14)).toBeNull();
    expect(getActiveMentionQuery("[@Binh](mention://member/u2)", 28)).toBeNull();
  });

  it("inserts mention display text and trailing space", () => {
    expect(insertMentionToken("hi @bi", 3, 6, "@Binh")).toEqual({
      nextDraft: "hi @Binh ",
      nextCursor: 9,
    });
  });

  it("serializes composer @ labels to markdown tokens on send", () => {
    const body = serializeComposerDraftToMessageBody(
      "hey @tran hoang long check this",
      [{ kind: "member", userId: "u1", label: "tran hoang long", email: "a@b.com" }],
      "all",
    );
    expect(body).toBe("hey [@tran hoang long](mention://member/u1) check this");
  });

  it("deserializes markdown mention tokens to composer @ labels", () => {
    expect(
      deserializeMessageBodyToComposerDraft(
        "[@tran hoang long](mention://member/01M1K1NA1DA5HFN6RPN02WV0Y9)",
      ),
    ).toBe("@tran hoang long");
    expect(deserializeMessageBodyToComposerDraft("[@all](mention://all/all)")).toBe("@all");
    expect(deserializeMessageBodyToComposerDraft("plain text")).toBe("plain text");
  });

  it("filters candidates and keeps @all at the top", () => {
    const candidates = filterMentionCandidates(
      [
        { kind: "member", userId: "u2", label: "Binh", email: "binh@example.com" },
        { kind: "member", userId: "u3", label: "Chi", email: "chi@example.com" },
      ],
      "bi",
      { allLabel: "all" },
    );
    expect(candidates[0]?.kind).toBe("all");
    expect(candidates.some((item) => item.userId === "u2")).toBe(true);
    expect(candidates.some((item) => item.userId === "u3")).toBe(false);
  });

  it("detects when current user is mentioned on a message", () => {
    expect(
      messageMentionsUser({ mentionedUserIds: ["USER2"] }, "user2"),
    ).toBe(true);
    expect(messageMentionsUser({ mentionedUserIds: ["USER2"] }, "USER9")).toBe(false);
  });
});
