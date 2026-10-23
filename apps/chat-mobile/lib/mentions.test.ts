// Parity: packages/views/chat/chat-mention-utils.test.ts verbatim, plus
// mentionSegments (the phone draws mentions without a markdown renderer).
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
  mentionCandidatesFromBody,
  messageBodyHasMention,
  resolveActiveMentionQuery,
  serializeComposerDraftToMessageBody,
  messageMentionsUser,
  mentionSegments,
  type ChatMentionCandidate,
} from "./mentions";

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
      serializeComposerDraftToMessageBody("hi @all there", [{ kind: "member", userId: "u1", label: "Ann" }], "all"),
    ).toBe("hi [@all](mention://all/all) there");
    expect(serializeComposerDraftToMessageBody("mail a@all.com", [], "all")).toBe("mail a@all.com");
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
    // A channel offers its roster (the profiles), not the whole workspace.
    expect(
      buildChatMentionCandidates(
        "channel",
        "me",
        members,
        { u3: { user_id: "u3", display_name: "Three", email: "u3@x.com" } },
        (m) => m.display_name,
      ),
    ).toEqual([{ kind: "member", userId: "u3", label: "Three", email: "u3@x.com" }]);
    expect(
      buildChatMentionCandidates(
        "group",
        "me",
        [{ user_id: "u3", email: "u3@x.com", display_name: "Three" }],
        {},
        (m) => m.display_name,
        ["ME", "u3"],
      ),
    ).toEqual([{ kind: "member", userId: "u3", label: "Three", email: "u3@x.com" }]);
    const three = { u3: { user_id: "u3", display_name: "Three", email: "u3@x.com" } };
    expect(
      buildChatMentionCandidates("channel", "me", members, three, (m) => m.display_name, ["u3"]),
    ).toEqual([{ kind: "member", userId: "u3", label: "Three", email: "u3@x.com" }]);
    // A channel only I am in lists nobody else: workspace members outside it would get a chip but no notification.
    expect(buildChatMentionCandidates("channel", "me", members, {}, (m) => m.display_name, [])).toEqual([]);
    expect(buildChatMentionCandidates("channel", "me", members, {}, (m) => m.display_name)).toEqual([]);
  });

  it("does not nest a shorter name inside a longer one", () => {
    const people = [
      { kind: "member" as const, userId: "U1", label: "Minh" },
      { kind: "member" as const, userId: "U2", label: "Minh Anh" },
    ];
    expect(serializeComposerDraftToMessageBody("@Minh Anh ơi", people, "all")).toBe(
      "[@Minh Anh](mention://member/U2) ơi",
    );
    expect(serializeComposerDraftToMessageBody("@Minh và @Minh Anh", people, "all")).toBe(
      "[@Minh](mention://member/U1) và [@Minh Anh](mention://member/U2)",
    );
  });

  it("gives members who share a name distinct labels", () => {
    const candidates = buildChatMentionCandidates(
      "workspace",
      "me",
      [
        { user_id: "u1", email: "an.nguyen@x.com", display_name: "An" },
        { user_id: "u2", email: "an.tran@x.com", display_name: "An" },
        { user_id: "u3", email: "", display_name: "Binh" },
        { user_id: "u4", email: "", display_name: "Binh" },
      ],
      {},
      (m) => m.display_name,
    );
    expect(candidates.map((candidate) => candidate.label)).toEqual([
      "An (an.nguyen)",
      "An (an.tran)",
      "Binh (u3)",
      "Binh (u4)",
    ]);
    expect(serializeComposerDraftToMessageBody("@An (an.tran) xem", candidates, "all")).toBe(
      "[@An (an.tran)](mention://member/u2) xem",
    );
  });

  it("keeps the original mention ids when an edited message is serialized", () => {
    const original = "[@An](mention://member/u2) xem [@all](mention://all/all)";
    const fromNameContext = [
      { kind: "member" as const, userId: "u1", label: "An" },
      { kind: "member" as const, userId: "u2", label: "An" },
    ];
    expect(mentionCandidatesFromBody(original)).toEqual([{ kind: "member", userId: "u2", label: "An" }]);
    const edited = deserializeMessageBodyToComposerDraft(original) + " nhé";
    expect(
      serializeComposerDraftToMessageBody(
        edited,
        [...mentionCandidatesFromBody(original), ...fromNameContext],
        "all",
      ),
    ).toBe("[@An](mention://member/u2) xem [@all](mention://all/all) nhé");
  });

  it("keeps a multi-word name open and matches without accents", () => {
    const people = [{ kind: "member" as const, userId: "u1", label: "Tuấn Hoàng", email: "t@x.com" }];
    expect(resolveActiveMentionQuery("@tuan ho", 8, people, "all")).toEqual({ start: 0, query: "tuan ho" });
    expect(resolveActiveMentionQuery("hello @bi world", 14, [{ kind: "member", userId: "u2", label: "Binh" }], "all")).toBeNull();
    expect(resolveActiveMentionQuery("@Tuấn Hoàng ", 12, people, "all")).toBeNull();
    expect(filterMentionCandidates(people, "tuan", { allLabel: "all" }).some((item) => item.userId === "u1")).toBe(true);
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

describe("mention edge cases the web suite leaves out", () => {
  const person = (user_id: string, display_name: string, email = "") => ({ user_id, display_name, email });

  it("writes @all with the default label when the room's label sanitizes away", () => {
    expect(serializeComposerDraftToMessageBody("@all hi", [], "]")).toBe("[@all](mention://all/all) hi");
  });

  it("merges a room profile with the workspace member, skips an unknown roster id, and splits shared names twice", () => {
    const candidates = buildChatMentionCandidates(
      "group",
      "me",
      [person("u1", "Lan", "lan@a.vn"), person("u3", "Minh", "minh@a.vn"), person("u4", "Minh", "minh@b.vn")],
      { u1: person("u1", "", ""), u2: person("", "", ""), u5: person("u5", "", "") },
      (member) => member.display_name || member.email || member.user_id,
      ["u1", "ghost", "u3", "u4", "u5"],
    );
    expect(candidates).toEqual([
      { kind: "member", userId: "u1", label: "Lan", email: "lan@a.vn" },
      { kind: "member", userId: "u3", label: "Minh (minh) (u3)", email: "minh@a.vn" },
      { kind: "member", userId: "u4", label: "Minh (minh) (u4)", email: "minh@b.vn" },
      { kind: "member", userId: "u5", label: "u5", email: "" },
    ]);
  });

  it("suffixes a shared name by user id when there is no email", () => {
    const candidates = buildChatMentionCandidates(
      "workspace",
      "me",
      [person("u1", "An"), person("u2", "An")],
      {},
      (member) => member.display_name,
    );
    expect(candidates.map((candidate) => candidate.label)).toEqual(["An (u1)", "An (u2)"]);
  });

  it("resolves the active query through every early exit", () => {
    const people: ChatMentionCandidate[] = [
      { kind: "all", label: "all" },
      { kind: "member", userId: "u0", label: "" },
      { kind: "member", userId: "u1", label: "Tuấn Hoàng" },
      { kind: "member", userId: "u2", label: "Zed", email: "lan.anh@x.vn" },
    ];
    expect(resolveActiveMentionQuery("@tu", 3, people, "all")).toEqual({ start: 0, query: "tu" });
    expect(resolveActiveMentionQuery("hello", 5, people, "all")).toBeNull();
    expect(resolveActiveMentionQuery("@ ", 2, people, "all")).toBeNull();
    expect(resolveActiveMentionQuery("@a\nb", 4, people, "all")).toBeNull();
    expect(resolveActiveMentionQuery("](@ab c", 7, people, "all")).toBeNull();
    expect(resolveActiveMentionQuery("@x](y z", 7, people, "all")).toBeNull();
    expect(resolveActiveMentionQuery("@tuan ", 6, people, "all")).toEqual({ start: 0, query: "tuan " });
    expect(resolveActiveMentionQuery("@lan anh", 8, people, "all")).toEqual({ start: 0, query: "lan anh" });
  });

  it("filters candidates that have no email by label alone", () => {
    expect(filterMentionCandidates([{ kind: "member", userId: "u1", label: "Lan" }], "minh", { allLabel: "all", includeAll: false })).toEqual([]);
  });
});

describe("mentionSegments", () => {
  it("splits a body into text and mention runs, with the user id of a member mention", () => {
    expect(mentionSegments("Hi [@Binh](mention://member/u2), and [@all](mention://all/all)!")).toEqual([
      { text: "Hi " },
      { text: "@Binh", mention: "member", userId: "u2" },
      { text: ", and " },
      { text: "@all", mention: "all" },
      { text: "!" },
    ]);
  });

  it("returns one text run for a body without tokens, and nothing for an empty one", () => {
    expect(mentionSegments("plain")).toEqual([{ text: "plain" }]);
    expect(mentionSegments("[@all](mention://all/all)")).toEqual([{ text: "@all", mention: "all" }]);
    expect(mentionSegments("")).toEqual([]);
  });
});
