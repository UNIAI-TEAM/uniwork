import { describe, expect, it } from "vitest";
import {
  AVATAR_ROUTE_FRAME_VERSIONS,
  frameAvatarContext,
  frameAvatarUrl,
  frameCandidates,
  frameCommentList,
  frameCommentResult,
  frameKnowsAvatarRoute,
} from "./frame-avatar-url";

const DOC = "01M4KH88167D722JAC9EAPKN33";
const USER = "01J8X4K2M0N1P2Q3R4S5T6V7W8";
const PATH = `/api/v1/office-frame/documents/${DOC}/avatars/${USER}`;
const PICTURE = "https://storage.example.test/avatars/an.png?X-Amz-Signature=abc";
const PINNED = "0.1.0-test";

const known = { documentId: DOC, routeKnown: true };
const unknown = { documentId: DOC, routeKnown: false };

describe("frameKnowsAvatarRoute (the version gate)", () => {
  it("only the avatar build (0.1.0-c4b20c5) is listed: a listed build gets the route, an unlisted one still gets `\"\"`", () => {
    // A later re-pin to a fork bundle that keeps the avatar loader adds its version to AVATAR_ROUTE_FRAME_VERSIONS.
    expect(AVATAR_ROUTE_FRAME_VERSIONS).toEqual(["0.1.0-c4b20c5"]);
    expect(frameKnowsAvatarRoute("0.1.0-c4b20c5")).toBe(true);
    expect(frameAvatarContext(DOC, "0.1.0-c4b20c5").routeKnown).toBe(true);
    expect(frameKnowsAvatarRoute("0.1.0-d57e60f")).toBe(false);
    expect(frameAvatarContext(DOC, "0.1.0-d57e60f").routeKnown).toBe(false);
    expect(frameKnowsAvatarRoute("")).toBe(false);
  });

  it("a listed build rewrites a human with a picture to the route, an unlisted build leaves `\"\"`", () => {
    const picture = "https://storage.example.test/avatars/an.png";
    expect(frameAvatarUrl(frameAvatarContext(DOC, "0.1.0-c4b20c5"), "human", USER, picture)).toBe(PATH);
    expect(frameAvatarUrl(frameAvatarContext(DOC, "0.1.0-d57e60f"), "human", USER, picture)).toBe("");
  });

  it("knows exactly the listed builds, and never an empty (not installed) version", () => {
    expect(frameKnowsAvatarRoute(PINNED, [PINNED])).toBe(true);
    expect(frameKnowsAvatarRoute("0.1.0-other", [PINNED])).toBe(false);
    expect(frameKnowsAvatarRoute("", [PINNED, ""])).toBe(false);
  });
});

describe("frameAvatarUrl", () => {
  it("a human with a picture gets the same-origin route: upper-case ULIDs, no host, no query", () => {
    expect(frameAvatarUrl(known, "human", USER, PICTURE)).toBe(PATH);
    // Whatever shape the server's URL has, it is only the signal "has a picture"; it never reaches the frame.
    expect(frameAvatarUrl(known, "human", USER, "/files/avatar.png")).toBe(PATH);
  });

  it("a frame that does not know the route gets `\"\"` for everyone", () => {
    expect(frameAvatarUrl(unknown, "human", USER, PICTURE)).toBe("");
  });

  it("an agent or a system author, or an item of unknown kind, gets `\"\"`", () => {
    expect(frameAvatarUrl(known, "agent", USER, PICTURE)).toBe("");
    expect(frameAvatarUrl(known, "system", USER, PICTURE)).toBe("");
    expect(frameAvatarUrl(known, undefined, USER, PICTURE)).toBe("");
  });

  it("no picture is `\"\"`: empty, absent or not a string", () => {
    expect(frameAvatarUrl(known, "human", USER, "")).toBe("");
    expect(frameAvatarUrl(known, "human", USER, undefined)).toBe("");
    expect(frameAvatarUrl(known, "human", USER, null)).toBe("");
    expect(frameAvatarUrl(known, "human", USER, 5)).toBe("");
  });

  it("an id that is not an upper-case ULID, or an author without an id, is `\"\"` (the route would not match it)", () => {
    expect(frameAvatarUrl(known, "human", USER.toLowerCase(), PICTURE)).toBe("");
    expect(frameAvatarUrl(known, "human", "u-1", PICTURE)).toBe("");
    expect(frameAvatarUrl(known, "human", "", PICTURE)).toBe("");
    expect(frameAvatarUrl(known, "human", null, PICTURE)).toBe("");
    expect(frameAvatarUrl(known, "human", undefined, PICTURE)).toBe("");
    expect(frameAvatarUrl({ documentId: "doc-1", routeKnown: true }, "human", USER, PICTURE)).toBe("");
    // A crafted id never gets into the path.
    expect(frameAvatarUrl(known, "human", `${USER}/../x`, PICTURE)).toBe("");
    expect(frameAvatarUrl(known, "human", `${USER}?x=1`, PICTURE)).toBe("");
  });
});

describe("the frame's answers", () => {
  const comment = (over: Record<string, unknown> = {}) => ({
    id: "c1", document_id: DOC, author_id: USER, author_kind: "human", body: "hello", kind: "comment", display_name: "An",
    avatar_url: PICTURE, author: { id: USER, kind: "human", avatar_url: PICTURE }, reactions: [], extra_field: { keep: 1 }, ...over,
  });

  it("comments.list: comment authors and mentions are rewritten, nothing else changes", () => {
    const mention = { user_id: USER, display_name: "An", avatar_url: PICTURE, state: "ok" };
    const list = { comments: [comment(), comment({ id: "c2", author_kind: "agent", author_id: "01J8X4AGE0N1P2Q3R4S5T6V7W8" }), comment({ id: "c3", avatar_url: "" }), comment({ id: "c4", avatar_url: undefined })],
      mentions: [mention, { user_id: USER, state: "unavailable" }], list_token: "lt1:aa", unchanged: false };
    const out = frameCommentList(known, list);
    expect(out.comments[0]).toEqual({ ...list.comments[0], avatar_url: PATH });
    expect(out.comments[1]).toEqual({ ...list.comments[1], avatar_url: "" });
    expect(out.comments[2]).toBe(list.comments[2]);
    expect(out.comments[3]).toBe(list.comments[3]);
    expect(out.mentions[0]).toEqual({ ...mention, avatar_url: PATH });
    // A mention with no avatar_url key is not given one.
    expect(out.mentions[1]).toBe(list.mentions[1]);
    expect(out.list_token).toBe("lt1:aa");
    expect(out.unchanged).toBe(false);
    // The input is never mutated.
    expect(list.comments[0]!.avatar_url).toBe(PICTURE);
  });

  it("the nested `author` object is not an avatar the frame reads: left as it came", () => {
    const out = frameCommentResult(known, { comment: comment() });
    expect(out.comment.author).toEqual({ id: USER, kind: "human", avatar_url: PICTURE });
  });

  it("an old frame gets `\"\"` on every picture and every other field is byte-identical", () => {
    const list = { comments: [comment()], mentions: [{ user_id: USER, avatar_url: PICTURE, state: "ok" }], list_token: "t", unchanged: false };
    const out = frameCommentList(unknown, list);
    expect(out.comments[0]).toEqual({ ...list.comments[0], avatar_url: "" });
    expect(out.mentions[0]).toEqual({ user_id: USER, avatar_url: "", state: "ok" });
  });

  it("a comment result (create, update, resolve, reopen) is rewritten and keeps its other keys", () => {
    const result = { comment: comment(), mentions_without_access: [{ user_id: "u2", can_share: true }] };
    const out = frameCommentResult(known, result);
    expect(out).toEqual({ ...result, comment: { ...result.comment, avatar_url: PATH } });
    expect(out.mentions_without_access).toBe(result.mentions_without_access);
  });

  it("mentions.search candidates are people: rewritten with a picture, `\"\"` otherwise, `can_view` and the rest kept", () => {
    const candidates = [
      { user_id: USER, display_name: "An", avatar_url: PICTURE, can_view: true, email: "an@example.test" },
      { user_id: "01J8X4K2M0BBBBBBBBBBBBBBBB", display_name: "Bình", avatar_url: "" },
      { user_id: "01J8X4K2M0CCCCCCCCCCCCCCCC", display_name: "Cường" },
      { user_id: "01J8X4AGE0DDDDDDDDDDDDDDDD", display_name: "Bot", avatar_url: PICTURE, kind: "agent" },
    ];
    const out = frameCandidates(known, { candidates });
    expect(out.candidates[0]).toEqual({ ...candidates[0], avatar_url: PATH });
    expect(out.candidates[1]).toBe(candidates[1]);
    expect(out.candidates[2]).toBe(candidates[2]);
    expect(out.candidates[3]).toEqual({ ...candidates[3], avatar_url: "" });
    expect(frameCandidates(unknown, { candidates }).candidates[0]).toEqual({ ...candidates[0], avatar_url: "" });
  });
});
