import { describe, expect, it } from "vitest";
import {
  buildChatMentionCandidates,
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

  it("sanitizes labels and falls back when empty after sanitize", () => {
    expect(formatMemberMentionToken("Bad]\nName", "u9")).toContain("Bad  Name");
    expect(formatMemberMentionToken("]\n", "u9")).toBe("[@u9](mention://member/u9)");
    expect(formatAllMentionToken("]\r")).toBe("[@all](mention://all/all)");
    expect(
      formatComposerMentionDisplay({ kind: "all", label: "all" }, "everyone"),
    ).toBe("@everyone");
    expect(
      formatComposerMentionDisplay(
        { kind: "member", userId: "u1", label: "]\n" },
        "all",
      ),
    ).toBe("@u1");
    expect(
      formatComposerMentionDisplay({ kind: "member", label: "]\n" }, "all"),
    ).toBe("@");
  });

  it("leaves drafts without @ unchanged and serializes @all", () => {
    expect(serializeComposerDraftToMessageBody("plain", [], "all")).toBe("plain");
    const withAll = serializeComposerDraftToMessageBody(
      "hi @all there",
      [{ kind: "all", label: "all" }, { kind: "member", userId: "u1", label: "Ann" }],
      "all",
    );
    expect(withAll).toContain("[@all](mention://all/all)");
    expect(
      serializeComposerDraftToMessageBody("@Ghost", [{ kind: "member", label: "" }], "all"),
    ).toBe("@Ghost");
    expect(
      serializeComposerDraftToMessageBody("@NoId", [{ kind: "member", label: "NoId" }], "all"),
    ).toBe("@NoId");
  });

  it("builds mention candidates for workspace and group targets", () => {
    const members = [
      { user_id: "me", email: "me@x.com", display_name: "Me" },
      { user_id: "u2", email: "u2@x.com", display_name: "Two" },
    ];
    expect(
      buildChatMentionCandidates("workspace", "me", members, {}, (m) => m.display_name),
    ).toEqual([
      { kind: "member", userId: "u2", label: "Two", email: "u2@x.com" },
    ]);
    expect(
      buildChatMentionCandidates(
        "group",
        "me",
        [],
        {
          me: { user_id: "me", display_name: "Me", email: "me@x.com" },
          u3: { user_id: "u3", display_name: "Three", email: "u3@x.com" },
        },
        (m) => m.display_name,
      ),
    ).toEqual([
      { kind: "member", userId: "u3", label: "Three", email: "u3@x.com" },
    ]);
    expect(buildChatMentionCandidates("dm", "me", members, {}, (m) => m.display_name)).toEqual(
      [],
    );
  });

  it("detects mention bodies and filters with includeAll disabled", () => {
    expect(messageBodyHasMention("hello mention://member/u1")).toBe(true);
    expect(messageBodyHasMention("[@ anywhere")).toBe(true);
    expect(messageBodyHasMention("plain")).toBe(false);
    expect(
      filterMentionCandidates(
        [
          { kind: "all", label: "all" },
          { kind: "member", userId: "u2", label: "Binh", email: "binh@example.com" },
        ],
        "",
        { allLabel: "all", includeAll: false },
      ),
    ).toEqual([
      { kind: "member", userId: "u2", label: "Binh", email: "binh@example.com" },
    ]);
    expect(messageMentionsUser({}, "u1")).toBe(false);
    expect(messageMentionsUser({ mentionedUserIds: [] }, "u1")).toBe(false);
  });

  it("rejects mention queries inside existing markdown tokens", () => {
    expect(getActiveMentionQuery("x](@bi", 6)).toBeNull();
    expect(getActiveMentionQuery("", 0)).toBeNull();
  });
});
