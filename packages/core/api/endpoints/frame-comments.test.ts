import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import {
  createFrameComment,
  deleteFrameComment,
  listFrameComments,
  putFrameCommentAnchors,
  reopenFrameComment,
  resolveFrameComment,
  searchFrameMentionCandidates,
  updateFrameComment,
  listFrameCommentRevisions,
} from "./frame-comments";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The server's wire comment (contract-collab §2.1). The frame reads fields this client does not
// know, so the proxy must hand every one of them through.
const wireComment = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  document_id: "d1",
  author_id: "u1",
  author_kind: "human",
  body: "Xem lại [@An](mention://member/u2)",
  kind: "comment",
  anchor: { format: "xlsx", v: 1, sheet: "S1", range: "B7" },
  anchor_version_id: "v1",
  anchor_state: "exact",
  deleted_at: null,
  revision: 1,
  ...over,
});

// The shared body fixture (contract-collab §3): a mention token + every Markdown-subset part. Copied
// verbatim from the fork's BODY_FIXTURE (web/docs/protocol/test/comments.test.ts in uniwork-office) so
// both sides of the relay pin the same bytes; keep the two in step.
const BODY_FIXTURE =
  "Xem lại [@Nguyễn \\[An\\]](mention://member/01J8X4USR0AAAAAAAAAAAAAAAA) giúp nhé:\n" +
  "**đậm**, *nghiêng*, `code [@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)`,\n" +
  "[liên kết](https://example.com/a?b=1&c=2)  \nxuống dòng — <b>không HTML</b> ✓";

const lastCall = () => {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1) ?? [];
  return { url: String(url), init: (init ?? {}) as RequestInit };
};

describe("frame comment endpoints (contract-collab §2)", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("lists with kind and since_token as query and returns the full answer untouched", async () => {
    const body = {
      comments: [wireComment()],
      mentions: [{ user_id: "u2", display_name: "An", state: "ok" }],
      list_token: "lt1:abc",
      unchanged: false,
    };
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    const out = await listFrameComments("d 1", { kind: "comment", since_token: "lt1:old" });
    expect(lastCall().url).toBe("http://api.test/api/v1/documents/d%201/comments?kind=comment&since_token=lt1%3Aold");
    expect(lastCall().init.method).toBe("GET");
    expect(out).toEqual(body);
  });

  it("lists without a query when the frame sends no filter", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comments: [], mentions: [], list_token: "lt1:a", unchanged: false }));
    await listFrameComments("d1", {});
    expect(lastCall().url).toBe("http://api.test/api/v1/documents/d1/comments");
  });

  it("an unchanged answer is {unchanged: true, list_token} and never carries a comments array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comments: [], mentions: [], list_token: "lt1:abc", unchanged: true }));
    expect(await listFrameComments("d1", { since_token: "lt1:abc" })).toEqual({ unchanged: true, list_token: "lt1:abc" });
  });

  it("an unchanged answer with comments missing is still unchanged (the frame keeps its list)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ list_token: "lt1:abc", unchanged: true }));
    expect(await listFrameComments("d1", { since_token: "lt1:abc" })).toEqual({ unchanged: true, list_token: "lt1:abc" });
  });

  it("a full list without a string list_token is malformed (null), never an empty token the frame would send back", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comments: [wireComment()] }));
    expect(await listFrameComments("d1", {})).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ comments: [wireComment()], list_token: 7, unchanged: false }));
    expect(await listFrameComments("d1", {})).toBeNull();
  });

  it.each([{ nope: true }, { comments: "x" }, { comments: [{ no_id: 1 }] }, null, [], "str"])(
    "a malformed list answer %j resolves null instead of throwing",
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect(await listFrameComments("d1", {})).toBeNull();
    },
  );

  it("creates with the body as sent, the idempotency key on the header, and returns the wire comment", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comment: wireComment() }, 201));
    const payload = { kind: "comment", body: "Xem", anchor: { format: "xlsx", v: 1 }, base_version_id: "v1" };
    const out = await createFrameComment("d1", payload, { idempotencyKey: "k-1" });
    const { url, init } = lastCall();
    expect(url).toBe("http://api.test/api/v1/documents/d1/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(payload);
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
    expect(out).toEqual({ comment: wireComment() });
  });

  it("creates the shared fixture body byte-identical in the request JSON and reads it back unchanged", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comment: wireComment({ body: BODY_FIXTURE, kind: "discussion" }) }, 201));
    const out = await createFrameComment("d1", { kind: "discussion", body: BODY_FIXTURE });
    const sent = String(lastCall().init.body);
    expect((JSON.parse(sent) as { body: string }).body).toBe(BODY_FIXTURE);
    expect(sent).toContain(JSON.stringify(BODY_FIXTURE));
    expect(out?.comment.body).toBe(BODY_FIXTURE);
  });

  it("parses a list answer carrying the shared fixture body byte-identical", async () => {
    const list = {
      comments: [wireComment({ body: BODY_FIXTURE })],
      mentions: [{ user_id: "01J8X4USR0AAAAAAAAAAAAAAAA", display_name: "Nguyễn An", state: "ok" }],
      list_token: "lt1:aa",
      unchanged: false,
    };
    vi.mocked(fetch).mockResolvedValueOnce(json(list));
    const out = await listFrameComments("d1", {});
    expect((out as { comments: Array<{ body: string }> }).comments[0]?.body).toBe(BODY_FIXTURE);
    expect(out).toEqual(list);
  });

  it("updates, resolves and reopens on the comment routes", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ comment: wireComment() })));
    await updateFrameComment("d1", "c1", { body: "x" });
    expect(lastCall().url).toBe("http://api.test/api/v1/documents/d1/comments/c1");
    expect(lastCall().init.method).toBe("PATCH");
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ body: "x" });
    await resolveFrameComment("d1", "c1");
    expect(lastCall().url).toBe("http://api.test/api/v1/documents/d1/comments/c1/resolve");
    expect(lastCall().init.method).toBe("POST");
    await reopenFrameComment("d1", "c1");
    expect(lastCall().url).toBe("http://api.test/api/v1/documents/d1/comments/c1/resolve");
    expect(lastCall().init.method).toBe("DELETE");
  });

  it("deletes and reports the outcome the server named", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok", outcome: "tombstoned" }));
    expect(await deleteFrameComment("d1", "c1")).toEqual({ outcome: "tombstoned" });
    expect(lastCall().init.method).toBe("DELETE");
  });

  it("a delete answer from a server before outcome existed reads as removed (the thread is gone either way)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    expect(await deleteFrameComment("d1", "c1")).toEqual({ outcome: "removed" });
  });

  it("reads revisions newest first as the server sends them", async () => {
    const revisions = [{ id: "r2", revision: 2, body: "b", created_by_id: "u1", created_by_kind: "human", created_at: "t" }];
    vi.mocked(fetch).mockResolvedValueOnce(json({ revisions }));
    expect(await listFrameCommentRevisions("d1", "c1")).toEqual({ revisions });
    expect(lastCall().url).toBe("http://api.test/api/v1/documents/d1/comments/c1/revisions");
  });

  it("puts anchors on the static anchors route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ updated: ["c1"], skipped: [{ comment_id: "c2", reason: "older_version" }], list_token: "lt1:z" }));
    const payload = { version_id: "v2", anchors: [{ comment_id: "c1", anchor: { format: "docx", v: 1 }, state: "exact" }] };
    const out = await putFrameCommentAnchors("d1", payload);
    expect(lastCall().url).toBe("http://api.test/api/v1/documents/d1/comments/anchors");
    expect(lastCall().init.method).toBe("PUT");
    expect(JSON.parse(String(lastCall().init.body))).toEqual(payload);
    expect(out).toEqual({ updated: ["c1"], skipped: [{ comment_id: "c2", reason: "older_version" }], list_token: "lt1:z" });
  });

  it("searches mention candidates with q and limit", async () => {
    const candidates = [{ user_id: "u2", display_name: "An" }];
    vi.mocked(fetch).mockResolvedValueOnce(json({ candidates }));
    expect(await searchFrameMentionCandidates("d1", { q: "ng", limit: 5 })).toEqual({ candidates });
    expect(lastCall().url).toBe("http://api.test/api/v1/documents/d1/mention-candidates?q=ng&limit=5");
  });

  it.each([
    ["create", () => createFrameComment("d1", { kind: "discussion", body: "x" })],
    ["update", () => updateFrameComment("d1", "c1", { body: "x" })],
    ["resolve", () => resolveFrameComment("d1", "c1")],
    ["reopen", () => reopenFrameComment("d1", "c1")],
    ["delete", () => deleteFrameComment("d1", "c1")],
    ["revisions", () => listFrameCommentRevisions("d1", "c1")],
    ["anchors", () => putFrameCommentAnchors("d1", { version_id: "v", anchors: [] })],
    ["mentions", () => searchFrameMentionCandidates("d1", { q: "a" })],
  ])("a malformed %s answer resolves null instead of throwing", async (_name, run) => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ nope: true })));
    expect(await run()).toBeNull();
  });

  it("a failed answer throws the transport's ApiError with the server's code, for the protocol mapping to read", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "comment_deleted", message: "gone" } }, 409),
    );
    const failure = await updateFrameComment("d1", "c1", { body: "x" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, code: "comment_deleted" });
  });
});
