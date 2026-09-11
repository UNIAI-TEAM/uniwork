import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  addCommentReaction,
  createCommentSuite,
  listTaskSubscribers,
  resolveComment,
  updateComment,
} from "./task-collaboration";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const comment = {
  id: "c1",
  task_id: "t1",
  author_id: "u1",
  body: "ok",
  type: "comment",
  revision: 1,
};

describe("task-collaboration endpoints", () => {
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

  it("updateComment / resolveComment return null on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ comment }))
      .mockResolvedValueOnce(json({ comment: { nope: true } }))
      .mockResolvedValueOnce(json({ comment: { nope: true } }));
    expect((await updateComment("c1", { body: "ok" }))?.id).toBe("c1");
    await expect(updateComment("c1", { body: "x" })).resolves.toBeNull();
    await expect(resolveComment("c1")).resolves.toBeNull();
  });

  it("addCommentReaction / listTaskSubscribers degrade on malformed", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ reaction: { id: 1 } }))
      .mockResolvedValueOnce(json({ subscribers: [{ task_id: 1 }] }));
    await expect(addCommentReaction("c1", { emoji: "👍" })).resolves.toBeNull();
    await expect(listTaskSubscribers("t1")).resolves.toEqual([]);
  });

  it("createCommentSuite sends Idempotency-Key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comment }));
    await createCommentSuite("t1", { body: "hi", parent_id: null }, { idempotencyKey: "k1" });
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
  });
});
