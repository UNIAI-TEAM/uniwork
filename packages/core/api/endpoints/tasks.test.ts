import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { addComment, createTask, deleteTask, listComments, listTasks, getTask, seedWelcomeTask, updateTask } from "./tasks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validTask = {
  id: "t1", workspace_id: "ws1", title: "Việc", description: "",
  status: "todo", priority: "medium", position: 1024, created_by: "u1",
  created_at: "2026-08-25T00:00:00Z", updated_at: "2026-08-25T00:00:00Z",
};

/**
 * Every endpoint gets the same three checks: a well-formed response comes
 * back typed, a malformed one comes back as the fallback WITHOUT throwing,
 * and a value this client predates (a new enum member) still parses. This is
 * the contract that keeps an API drift a degraded page instead of a white one.
 */
describe("tasks endpoints", () => {
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

  it("listTasks returns the tasks", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: [validTask] }));
    expect(await listTasks("ws1")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/tasks");
  });

  it("listTasks returns [] instead of throwing on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: [{ id: 1 }] }));
    await expect(listTasks("ws1")).resolves.toEqual([]);
  });

  it("listTasks lets an unknown status through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: [{ ...validTask, status: "archived" }] }));
    const [task] = await listTasks("ws1");
    expect(task?.status).toBe("archived");
  });

  it("getTask returns null on drift so the caller can render not-found", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: { nope: true } }));
    await expect(getTask("t1")).resolves.toBeNull();
  });

  it("getTask keeps task reactions and defaults an absent list", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({
          task: {
            ...validTask,
            reactions: [
              {
                id: "r1",
                task_id: "t1",
                actor_type: "member",
                actor_id: "u1",
                emoji: "❤️",
                created_at: "2026-09-15T00:00:00Z",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(json({ task: validTask }));

    expect((await getTask("t1"))?.reactions).toHaveLength(1);
    expect((await getTask("t1"))?.reactions).toEqual([]);
  });

  it("createTask posts the complete create context and idempotency key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: validTask }));
    const body = {
      title: "Việc",
      description: "Mô tả",
      status: "in_progress" as const,
      priority: "none" as const,
      assignee_id: "u2",
      assignee_kind: "human" as const,
      due_date: "2026-09-30",
      start_date: "2026-09-20",
      start_at: "2026-09-20T02:00:00Z",
      due_at: "2026-09-20T03:00:00Z",
      project_id: "p1",
      parent_task_id: "parent-1",
      stage: 2,
      properties: { "prop-1": 5 },
    };

    const created = await createTask("ws1", body, { idempotencyKey: "create-1" });

    expect(created?.id).toBe("t1");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Idempotency-Key": "create-1" });
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("createTask degrades a malformed success response to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: { nope: true } }));

    await expect(createTask("ws1", { title: "Việc" })).resolves.toBeNull();
  });

  it("updateTask posts the body and returns the task", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ task: { ...validTask, title: "Sửa" } }));
    const updated = await updateTask("t1", { title: "Sửa" });
    expect(updated?.title).toBe("Sửa");
  });

  it("updateTask sends an exact task schedule", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: validTask }));
    const schedule = {
      start_date: "2026-09-20",
      due_date: "2026-09-20",
      start_at: "2026-09-20T02:00:00Z",
      due_at: "2026-09-20T03:30:00Z",
    };

    await updateTask("t1", schedule);

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual(schedule);
  });

  it("deleteTask resolves with no body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(deleteTask("t1")).resolves.toBeUndefined();
  });

  it("listComments returns [] on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comments: "nope" }));
    await expect(listComments("t1")).resolves.toEqual([]);
  });

  it("listComments mặc định reactions về [] khi server cũ không trả trường đó", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ comments: [{ id: "c1", task_id: "t1", author_id: "u1", body: "một" }] }),
    );
    const got = await listComments("t1");
    expect(got[0]?.reactions).toEqual([]);
  });

  it("listComments giữ reactions server trả về", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        comments: [
          {
            id: "c1",
            task_id: "t1",
            author_id: "u1",
            body: "một",
            reactions: [
              {
                id: "r1",
                comment_id: "c1",
                actor_type: "member",
                actor_id: "u1",
                emoji: "👍",
                created_at: "2026-09-12T00:00:00Z",
              },
            ],
          },
        ],
      }),
    );
    const got = await listComments("t1");
    expect(got[0]?.reactions).toHaveLength(1);
  });

  it("listComments không loại bỏ cả danh sách khi một bình luận có reactions: null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        comments: [{ id: "c1", task_id: "t1", author_id: "u1", body: "một", reactions: null }],
      }),
    );
    const got = await listComments("t1");
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe("c1");
    expect(got[0]?.reactions).toEqual([]);
  });

  it("listComments giữ bình luận khi một reaction hỏng, chỉ mất reaction", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        comments: [
          {
            id: "c1",
            task_id: "t1",
            author_id: "u1",
            body: "một",
            reactions: [{ id: "r1", emoji: 42 }],
          },
        ],
      }),
    );
    const got = await listComments("t1");
    expect(got).toHaveLength(1);
    expect(got[0]?.body).toBe("một");
    expect(got[0]?.reactions).toEqual([]);
  });

  it("addComment posts the body and returns the comment", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ comment: { id: "c1", task_id: "t1", author_id: "u1", body: "nice" } }),
    );
    const comment = await addComment("t1", "nice");
    expect(comment?.id).toBe("c1");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ body: "nice" });
  });

  it("addComment returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comment: { nope: true } }));
    await expect(addComment("t1", "nice")).resolves.toBeNull();
  });

  it("seedWelcomeTask returns the task and null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: validTask }));
    expect((await seedWelcomeTask("ws1"))?.id).toBe("t1");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: { nope: true } }));
    await expect(seedWelcomeTask("ws1")).resolves.toBeNull();
  });
});
