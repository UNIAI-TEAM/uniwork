import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KEYS,
  COMMENTS_LEVELS,
  DocsProtocolError,
  PROTOCOL_ERROR_CODES,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  canActOnComment,
  checkInitComments,
  commentsAccess,
  commentsErrorFromHttp,
  isCommentsRequestType,
  parseEnvelope,
  type CommentsAccess,
  type CommentsLevel,
} from "./docs-frame-protocol";

// The fork tests the vendored protocol in depth (web/docs/protocol/test); these pin what the
// UniWork host relies on for G8-18 and DOC-05 (addendum §2, §3; DOC5-W02, DOC5-W04), through
// the vendored copy.

const init = (commentsLevel?: string, comments = true) =>
  ({ capabilities: { comments }, ...(commentsLevel === undefined ? {} : { commentsLevel }) }) as Parameters<typeof checkInitComments>[0];

describe("checkInitComments: the host's own init (DOC5-W04)", () => {
  it.each(COMMENTS_LEVELS)("accepts %s", (level) => {
    expect(checkInitComments(init(level))).toBeNull();
  });

  it("knows the comment level between view and edit", () => {
    expect(COMMENTS_LEVELS).toEqual(["view", "comment", "edit", "manage"]);
    expect(checkInitComments(init("comment"))).toBeNull();
  });

  it.each(["owner", "", "Comment", "admin"])("rejects the unknown level %j with comments_level_invalid", (level) => {
    const error = checkInitComments(init(level));
    expect(error).toBeInstanceOf(DocsProtocolError);
    expect(error).toMatchObject({ code: "malformed", details: { code: "comments_level_invalid" } });
  });

  it("rejects a missing level with comments_level_missing, and ignores init without comments", () => {
    expect(checkInitComments(init(undefined))).toMatchObject({ code: "malformed", details: { code: "comments_level_missing" } });
    expect(checkInitComments(init("owner", false))).toBeNull();
  });
});

describe("commentsAccess: the frame's side (DOC5-W04)", () => {
  it("a missing level is level null, never a guess", () => {
    expect(commentsAccess({ capabilities: { comments: true } })).toMatchObject({ enabled: true, level: null });
  });

  it("carries the comment level and lets it create", () => {
    expect(commentsAccess({ capabilities: { comments: true }, commentsLevel: "comment", user: { id: "u1" } })).toEqual({
      enabled: true,
      level: "comment",
      canCreate: true,
      userId: "u1",
    });
  });

  it("view creates nothing, and a 403 turns any level read-only", () => {
    expect(commentsAccess({ capabilities: { comments: true }, commentsLevel: "view" }).canCreate).toBe(false);
    expect(commentsAccess({ capabilities: { comments: true }, commentsLevel: "manage" }, { forbidden: true })).toMatchObject({ level: "view", canCreate: false });
  });
});

describe("canActOnComment at the comment level (DOC5-W02)", () => {
  const access = (level: CommentsLevel | null): CommentsAccess => ({ enabled: true, level, canCreate: level !== "view", userId: "me" });
  // A root comment of mine and a reply of mine in somebody else's thread.
  const myRoot = { author_id: "me", deleted_at: null, thread_author_id: "me" };
  const myReply = { author_id: "me", deleted_at: null, thread_author_id: "other" };
  const theirReplyInMyThread = { author_id: "other", deleted_at: null, thread_author_id: "me" };
  const theirRoot = { author_id: "other", deleted_at: null, thread_author_id: "other" };

  it("resolves and reopens the thread it started", () => {
    expect(canActOnComment(access("comment"), myRoot, "resolve")).toBe(true);
    expect(canActOnComment(access("comment"), myRoot, "reopen")).toBe(true);
    expect(canActOnComment(access("comment"), theirReplyInMyThread, "resolve")).toBe(true);
  });

  it("does not resolve a thread it only replied to", () => {
    expect(canActOnComment(access("comment"), myReply, "resolve")).toBe(false);
    expect(canActOnComment(access("comment"), myReply, "reopen")).toBe(false);
    expect(canActOnComment(access("comment"), theirRoot, "resolve")).toBe(false);
  });

  it("edits and deletes its own comments only", () => {
    expect(canActOnComment(access("comment"), myReply, "edit")).toBe(true);
    expect(canActOnComment(access("comment"), myReply, "delete")).toBe(true);
    expect(canActOnComment(access("comment"), theirRoot, "edit")).toBe(false);
    expect(canActOnComment(access("comment"), theirRoot, "delete")).toBe(false);
  });

  it("edit and manage resolve every thread; only manage touches others' comments", () => {
    for (const level of ["edit", "manage"] as const) expect(canActOnComment(access(level), theirRoot, "resolve")).toBe(true);
    expect(canActOnComment(access("edit"), theirRoot, "delete")).toBe(false);
    expect(canActOnComment(access("manage"), theirRoot, "delete")).toBe(true);
  });

  it("view acts on nothing, and a deleted comment on nothing", () => {
    expect(canActOnComment(access("view"), myRoot, "edit")).toBe(false);
    expect(canActOnComment(access("comment"), { ...myRoot, deleted_at: "2026-10-14T00:00:00Z" }, "edit")).toBe(false);
  });

  it("without a thread author the comment itself is the root (a frame that predates the field)", () => {
    expect(canActOnComment(access("comment"), { author_id: "me", deleted_at: null }, "resolve")).toBe(true);
    expect(canActOnComment(access("comment"), { author_id: "other", deleted_at: null }, "resolve")).toBe(false);
  });

  it("a missing level acts on its own comments and its own threads, never on others", () => {
    expect(canActOnComment(access(null), myReply, "edit")).toBe(true);
    expect(canActOnComment(access(null), myReply, "resolve")).toBe(false);
    expect(canActOnComment(access(null), theirRoot, "delete")).toBe(false);
  });
});

describe("comments.shareView and the commentsShareView capability (G8-18)", () => {
  const envelope = (kind: string, payload: unknown) => ({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: "f1", kind, type: "comments.shareView", payload });

  it("is a comments request and a capability key", () => {
    expect(isCommentsRequestType("comments.shareView")).toBe(true);
    expect(CAPABILITY_KEYS).toContain("commentsShareView");
  });

  it("validates {user_id} on the request and {ok:true} on the response", () => {
    expect(parseEnvelope(envelope("request", { user_id: "u2" }))).toMatchObject({ ok: true });
    for (const bad of [{}, { user_id: "" }, { user_id: 7 }, null]) {
      expect(parseEnvelope(envelope("request", bad))).toMatchObject({ ok: false, reason: "malformed" });
    }
    expect(parseEnvelope(envelope("response", { ok: true }))).toMatchObject({ ok: true });
    expect(parseEnvelope(envelope("response", { ok: false }))).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("types mentions.search include=no_access and rejects any other include", () => {
    const search = (payload: unknown) => parseEnvelope({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: "f2", kind: "request", type: "mentions.search", payload });
    expect(search({ q: "b", include: "no_access" })).toMatchObject({ ok: true });
    expect(search({ q: "b", include: "everyone" })).toMatchObject({ ok: false });
  });

  it("maps 422 to invalid_arg, 409 to conflict, 403 to forbidden", () => {
    expect(PROTOCOL_ERROR_CODES).toContain("invalid_arg");
    expect(commentsErrorFromHttp(422, { error: { code: "principal_not_in_organization" } })).toMatchObject({ code: "invalid_arg", details: { code: "principal_not_in_organization" } });
    expect(commentsErrorFromHttp(409, { error: { code: "document_owned_by_work_product" } })).toMatchObject({ code: "conflict" });
    expect(commentsErrorFromHttp(403, { error: { code: "break_glass_required" } })).toMatchObject({ code: "forbidden" });
    expect(commentsErrorFromHttp(403, { error: { code: "document_restricted" } })).toMatchObject({ code: "forbidden" });
  });

  it("a comment carries mentions_without_access and a candidate can_view through validation", () => {
    const comment = { id: "c1", document_id: "d1", kind: "comment", body: "x", author_id: "a", created_at: "2026-10-14T00:00:00Z", mentions_without_access: [{ user_id: "u2", can_share: true }] };
    const created = parseEnvelope({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: "f3", kind: "response", type: "comments.create", payload: { comment } });
    expect(created).toMatchObject({ ok: true });
    const bad = { ...comment, mentions_without_access: [{ user_id: "u2" }] };
    expect(parseEnvelope({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: "f4", kind: "response", type: "comments.create", payload: { comment: bad } })).toMatchObject({ ok: false });
    const found = parseEnvelope({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: "f5", kind: "response", type: "mentions.search", payload: { candidates: [{ user_id: "u2", display_name: "B", can_view: false }] } });
    expect(found).toMatchObject({ ok: true });
  });
});
