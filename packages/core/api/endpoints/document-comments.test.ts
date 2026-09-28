import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  addDocumentCommentReaction,
  createDocumentComment,
  deleteDocumentComment,
  listDocumentComments,
  removeDocumentCommentReaction,
  reopenDocumentComment,
  resolveDocumentComment,
  updateDocumentComment,
} from "./document-comments";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const commentBody = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  document_id: "d1",
  author_id: "u1",
  author_kind: "human",
  author: { id: "u1", kind: "human", display_name: "An" },
  body: "Chỗ này cần số liệu Q3.",
  type: "comment",
  revision: 1,
  created_at: "2026-09-28T08:00:00Z",
  updated_at: "2026-09-28T08:00:00Z",
  display_name: "An",
  reactions: [
    {
      id: "r1",
      comment_id: "c1",
      actor_type: "member",
      actor_id: "u1",
      emoji: "👍",
      created_at: "2026-09-28T08:01:00Z",
    },
  ],
  ...over,
});

const reactionBody = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  comment_id: "c1",
  actor_type: "member",
  actor_id: "u1",
  emoji: "👍",
  created_at: "2026-09-28T08:01:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { comment: "x" }, null, [], "str"];

describe("document comment endpoints", () => {
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

  // ---- wire shape -------------------------------------------------------

  it("listDocumentComments reads the thread from the document route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comments: [commentBody()] }));
    const out = await listDocumentComments("d1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/comments");
    expect(init?.method).toBe("GET");
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("c1");
    expect(out[0]?.type).toBe("comment");
    expect(out[0]?.reactions[0]?.emoji).toBe("👍");
  });

  it("createDocumentComment posts body + parent_id with the idempotency header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comment: commentBody({ parent_id: "c0" }) }));
    const out = await createDocumentComment(
      "d1",
      { body: "Đồng ý", parent_id: "c0" },
      { idempotencyKey: "key-1" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/comments");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("key-1");
    expect(JSON.parse(String(init?.body))).toEqual({ body: "Đồng ý", parent_id: "c0" });
    expect(out?.parent_id).toBe("c0");
  });

  it("updateDocumentComment PATCHes the comment route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comment: commentBody({ revision: 2 }) }));
    const out = await updateDocumentComment("d1", "c1", { body: "bản sửa" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/comments/c1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ body: "bản sửa" });
    expect(out?.revision).toBe(2);
  });

  it("deleteDocumentComment DELETEs the comment route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await deleteDocumentComment("d1", "c1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/comments/c1");
    expect(init?.method).toBe("DELETE");
  });

  it("resolve and reopen use the resolve route with POST and DELETE", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ comment: commentBody({ resolved_at: "2026-09-28T09:00:00Z" }) }),
    );
    const resolved = await resolveDocumentComment("d1", "c1");
    const [resolveUrl, resolveInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(resolveUrl)).toBe("http://api.test/api/v1/documents/d1/comments/c1/resolve");
    expect(resolveInit?.method).toBe("POST");
    expect(resolved?.resolved_at).toBe("2026-09-28T09:00:00Z");

    vi.mocked(fetch).mockResolvedValueOnce(json({ comment: commentBody() }));
    const reopened = await reopenDocumentComment("d1", "c1");
    const [reopenUrl, reopenInit] = vi.mocked(fetch).mock.calls[1]!;
    expect(String(reopenUrl)).toBe("http://api.test/api/v1/documents/d1/comments/c1/resolve");
    expect(reopenInit?.method).toBe("DELETE");
    expect(reopened?.resolved_at).toBeUndefined();
  });

  it("add and remove comment reactions post the emoji body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ reaction: reactionBody() }));
    const reaction = await addDocumentCommentReaction("d1", "c1", { emoji: "👍" });
    const [addUrl, addInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(addUrl)).toBe("http://api.test/api/v1/documents/d1/comments/c1/reactions");
    expect(addInit?.method).toBe("POST");
    expect(JSON.parse(String(addInit?.body))).toEqual({ emoji: "👍" });
    expect(reaction?.comment_id).toBe("c1");

    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await removeDocumentCommentReaction("d1", "c1", { emoji: "👍" });
    const [removeUrl, removeInit] = vi.mocked(fetch).mock.calls[1]!;
    expect(String(removeUrl)).toBe("http://api.test/api/v1/documents/d1/comments/c1/reactions");
    expect(removeInit?.method).toBe("DELETE");
    expect(JSON.parse(String(removeInit?.body))).toEqual({ emoji: "👍" });
  });

  // ---- lenience + malformed responses -----------------------------------

  it("keeps the comment when one reaction row is malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ comments: [commentBody({ reactions: [{ nope: true }] })] }),
    );
    const out = await listDocumentComments("d1");
    expect(out).toHaveLength(1);
    expect(out[0]?.reactions).toEqual([]);
  });

  it("degrades the thread to [] when the envelope is malformed", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(listDocumentComments("d1")).resolves.toEqual([]);
    }
  });

  it("returns null instead of a half-written comment (create/update/resolve/reopen)", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(createDocumentComment("d1", { body: "x" })).resolves.toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(updateDocumentComment("d1", "c1", { body: "x" })).resolves.toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(resolveDocumentComment("d1", "c1")).resolves.toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(reopenDocumentComment("d1", "c1")).resolves.toBeNull();
    }
  });

  it("returns null for a malformed reaction and never throws on the void routes", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(addDocumentCommentReaction("d1", "c1", { emoji: "👍" })).resolves.toBeNull();
    }
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(deleteDocumentComment("d1", "c1")).resolves.toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(removeDocumentCommentReaction("d1", "c1", { emoji: "👍" })).resolves.toBeUndefined();
  });
});
