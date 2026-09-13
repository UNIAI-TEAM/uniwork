import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";
import { applyTaskPatchFrame, parseTaskPatchFrame, type TaskPatchFrame } from "./realtime-task-patch";

// Frames below have the exact shape the server emits after f00f289
// (.superpowers/sdd/2026-09-14-tasks-human-parity-slice-e/task-2-fix-report.md):
// map[string]string, revisions beside at least one Patch field.

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  organization_id: "o1",
  workspace_id: "ws1",
  number: 1,
  identifier: "ALP-1",
  revision: 5,
  title: "Tiêu đề cũ",
  description: "Mô tả của người khác",
  status: "todo",
  priority: "medium",
  assignee_id: "u2",
  assignee_kind: "human",
  due_date: "2026-09-01",
  position: 3,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...over,
});

const payload = (over: Record<string, unknown> = {}): Record<string, string> =>
  ({
    task_id: "t1",
    workspace_id: "ws1",
    revision_before: "5",
    revision: "7",
    title: "Tiêu đề mới",
    ...over,
  }) as Record<string, string>;

const decoded = (over: Record<string, unknown> = {}): TaskPatchFrame => {
  const frame = parseTaskPatchFrame(payload(over));
  if (!frame) throw new Error("fixture frame must decode");
  return frame;
};

describe("parseTaskPatchFrame", () => {
  it("keeps only Patch fields and ignores every other key", () => {
    expect(
      parseTaskPatchFrame(
        payload({ assignee_id: "u9", description: "smuggled", position: "0", smuggled: "x" }),
      ),
    ).toEqual({ taskId: "t1", revisionBefore: 5, revision: 7, fields: { title: "Tiêu đề mới" } });
  });

  it("decodes all four Patch fields as strings, enum values outside the known set included", () => {
    expect(
      parseTaskPatchFrame(
        payload({ status: "someday", priority: "p0", due_date: "2026-10-01" }),
      )?.fields,
    ).toEqual({ title: "Tiêu đề mới", status: "someday", priority: "p0", due_date: "2026-10-01" });
  });

  it("decodes a cleared due_date (empty string) as null", () => {
    const { title: _title, ...noTitle } = payload({ due_date: "" });
    expect(parseTaskPatchFrame(noTitle)?.fields).toEqual({ due_date: null });
  });

  it("is ids-only when the frame has both revisions but no Patch field", () => {
    // Outbox rows written before f00f289 sent the pair for mixed and empty input.
    const { title: _title, ...noTitle } = payload({ description: "mới" });
    expect(parseTaskPatchFrame(noTitle)).toBeNull();
    expect(parseTaskPatchFrame({ task_id: "t1", workspace_id: "ws1" })).toBeNull();
  });

  it.each([
    ["revision_before missing", { revision_before: undefined }],
    ["revision missing", { revision: undefined }],
    ["empty revision", { revision: "" }],
    ["negative revision_before", { revision_before: "-1" }],
    ["fractional revision", { revision: "7.5" }],
    ["non-numeric revision", { revision: "abc" }],
    ["padded revision", { revision: " 7" }],
    ["exponent revision", { revision: "1e3" }],
    ["hex revision", { revision: "0x7" }],
    ["unsafe integer revision", { revision: "9007199254740993" }],
    ["number instead of string", { revision: 7 }],
    ["revision equal to revision_before", { revision: "5" }],
    ["revision below revision_before", { revision_before: "7", revision: "5" }],
  ])("is ids-only with %s", (_name, over) => {
    const raw = payload();
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) delete raw[k];
      else (raw as Record<string, unknown>)[k] = v;
    }
    expect(parseTaskPatchFrame(raw)).toBeNull();
  });

  it("accepts revision_before 0", () => {
    expect(parseTaskPatchFrame(payload({ revision_before: "0", revision: "1" }))).toMatchObject({
      revisionBefore: 0,
      revision: 1,
    });
  });

  it("rejects the whole frame when a Patch field cannot be applied, rather than drop it and take the revision", () => {
    expect(parseTaskPatchFrame(payload({ title: 42 }))).toBeNull();
    expect(parseTaskPatchFrame(payload({ status: null }))).toBeNull();
    expect(parseTaskPatchFrame(payload({ due_date: "01/10/2026" }))).toBeNull();
    expect(parseTaskPatchFrame(payload({ due_date: "2026-10-01T00:00:00Z" }))).toBeNull();
  });

  it("is ids-only without a task_id", () => {
    expect(parseTaskPatchFrame(payload({ task_id: undefined }))).toBeNull();
    expect(parseTaskPatchFrame(payload({ task_id: "" }))).toBeNull();
  });
});

describe("applyTaskPatchFrame", () => {
  const seeded = (data: Task | null = task()) => {
    const qc = new QueryClient();
    qc.setQueryData(taskKeys.detail("t1"), data);
    return qc;
  };

  it("patches the detail entry whose revision equals revision_before and takes the frame's revision", () => {
    const qc = seeded();
    expect(applyTaskPatchFrame(qc, "ws1", decoded())).toEqual({ detailPatched: true });
    expect(qc.getQueryData(taskKeys.detail("t1"))).toEqual(
      task({ title: "Tiêu đề mới", revision: 7 }),
    );
  });

  it("writes every Patch field the frame carries and nothing else", () => {
    const qc = seeded();
    applyTaskPatchFrame(
      qc,
      "ws1",
      decoded({ status: "in_progress", priority: "urgent", due_date: "2026-10-01", description: "smuggled" }),
    );
    expect(qc.getQueryData(taskKeys.detail("t1"))).toEqual(
      task({
        title: "Tiêu đề mới",
        status: "in_progress",
        priority: "urgent",
        due_date: "2026-10-01",
        revision: 7,
      }),
    );
  });

  it("leaves the patched record without due_date when the frame cleared it, as REST omits it", () => {
    const qc = seeded();
    const { title: _title, ...noTitle } = payload({ due_date: "", revision: "6" });
    const frame = parseTaskPatchFrame(noTitle);
    if (!frame) throw new Error("fixture frame must decode");
    applyTaskPatchFrame(qc, "ws1", frame);
    const next = qc.getQueryData<Task>(taskKeys.detail("t1"));
    expect(next).toBeDefined();
    expect(Object.hasOwn(next ?? {}, "due_date")).toBe(false);
    expect(next?.revision).toBe(6);
    expect(next?.title).toBe("Tiêu đề cũ");
  });

  it("does not patch when the cached revision differs from revision_before", () => {
    const cached = task({ revision: 6 });
    const qc = seeded(cached);
    expect(applyTaskPatchFrame(qc, "ws1", decoded())).toEqual({ detailPatched: false });
    expect(qc.getQueryData(taskKeys.detail("t1"))).toBe(cached);
  });

  it.each([7, 9])(
    "leaves alone an entry the author's own mutation response already moved to revision %i",
    (revision) => {
      const cached = task({ revision, title: "Tiêu đề mới" });
      const qc = seeded(cached);
      expect(applyTaskPatchFrame(qc, "ws1", decoded())).toEqual({ detailPatched: false });
      expect(qc.getQueryData(taskKeys.detail("t1"))).toBe(cached);
    },
  );

  it("never creates a detail entry", () => {
    const qc = new QueryClient();
    expect(applyTaskPatchFrame(qc, "ws1", decoded())).toEqual({ detailPatched: false });
    expect(qc.getQueryCache().find({ queryKey: taskKeys.detail("t1") })).toBeUndefined();
  });

  it("leaves a not-found (null) detail entry null", () => {
    const qc = seeded(null);
    expect(applyTaskPatchFrame(qc, "ws1", decoded())).toEqual({ detailPatched: false });
    expect(qc.getQueryData(taskKeys.detail("t1"))).toBeNull();
  });

  it("leaves an entry that is already refetching to that refetch", () => {
    // The in-flight response may predate the change; patching now would let it
    // overwrite the patch with older data after the detail key was skipped.
    const cached = task();
    const qc = seeded(cached);
    void qc.fetchQuery({ queryKey: taskKeys.detail("t1"), queryFn: () => new Promise<Task>(() => {}) });
    expect(qc.getQueryState(taskKeys.detail("t1"))?.fetchStatus).toBe("fetching");
    expect(applyTaskPatchFrame(qc, "ws1", decoded())).toEqual({ detailPatched: false });
    expect(qc.getQueryData(taskKeys.detail("t1"))).toBe(cached);
  });

  it("leaves an entry already marked invalidated to its pending refetch", () => {
    const cached = task();
    const qc = seeded(cached);
    void qc.invalidateQueries({ queryKey: taskKeys.detail("t1") });
    expect(qc.getQueryState(taskKeys.detail("t1"))?.isInvalidated).toBe(true);
    expect(applyTaskPatchFrame(qc, "ws1", decoded())).toEqual({ detailPatched: false });
    expect(qc.getQueryData(taskKeys.detail("t1"))).toBe(cached);
  });

});

describe("applyTaskPatchFrame on list-style caches", () => {
  const other = task({ id: "t2", title: "Việc khác", revision: 5 });
  const third = task({ id: "t3", title: "Việc thứ ba", revision: 5 });
  const page = (tasks: Task[], offset = 0) => ({ tasks, total: 3, limit: 50, offset });
  const patched = task({ title: "Tiêu đề mới", status: "done", revision: 7 });
  const statusFrame = () => decoded({ status: "done" });

  it("patches the task's row at revision_before in every list-style cache, in place, copying only what holds it", () => {
    const qc = new QueryClient();
    const row = task();
    const list = [other, row, third];
    const plain = page([row, other]);
    const firstPage = page([other, third]);
    const infinite = { pages: [firstPage, page([row], 50)], pageParams: [0, 50] };
    const myPlain = page([other, row]);
    const myInfinite = { pages: [page([row]), firstPage], pageParams: [0, 50] };
    const doneGroup = { key: "done", tasks: [other] };
    const grouped = [{ key: "todo", tasks: [third, row] }, doneGroup];
    const otherTableRow = { task: other, direct_child_count: 0 };
    const table = {
      query_fingerprint: "f",
      total: 2,
      branch_total: 2,
      rows: [otherTableRow, { task: row, direct_child_count: 2 }],
    };
    qc.setQueryData(taskKeys.list("ws1"), list);
    qc.setQueryData(taskKeys.query("ws1", "h"), plain);
    qc.setQueryData(taskKeys.queryInfinite("ws1", "h"), infinite);
    qc.setQueryData(taskKeys.myTasksFiltered("ws1", "h"), myPlain);
    qc.setQueryData(taskKeys.myTasksInfinite("ws1", "h"), myInfinite);
    qc.setQueryData(taskKeys.grouped("ws1", "h"), grouped);
    qc.setQueryData(taskKeys.tableRows("ws1", "h"), table);

    expect(applyTaskPatchFrame(qc, "ws1", statusFrame())).toEqual({ detailPatched: false });

    const nextList = qc.getQueryData<Task[]>(taskKeys.list("ws1"));
    expect(nextList).toEqual([other, patched, third]);
    expect(nextList?.[0]).toBe(other);
    expect(nextList?.[2]).toBe(third);

    expect(qc.getQueryData(taskKeys.query("ws1", "h"))).toEqual(page([patched, other]));

    const nextInfinite = qc.getQueryData<typeof infinite>(taskKeys.queryInfinite("ws1", "h"));
    expect(nextInfinite?.pages[1]).toEqual(page([patched], 50));
    expect(nextInfinite?.pages[0]).toBe(firstPage);
    expect(nextInfinite?.pageParams).toBe(infinite.pageParams);

    expect(qc.getQueryData(taskKeys.myTasksFiltered("ws1", "h"))).toEqual(page([other, patched]));
    const nextMyInfinite = qc.getQueryData<typeof myInfinite>(taskKeys.myTasksInfinite("ws1", "h"));
    expect(nextMyInfinite?.pages[0]).toEqual(page([patched]));
    expect(nextMyInfinite?.pages[1]).toBe(firstPage);

    // The status changed to "done", yet the row stays in the "todo" group, in
    // its place: grouping and order come back with the list refetch.
    const nextGrouped = qc.getQueryData<typeof grouped>(taskKeys.grouped("ws1", "h"));
    expect(nextGrouped?.map((g) => [g.key, g.tasks.map((t) => t.id)])).toEqual([
      ["todo", ["t3", "t1"]],
      ["done", ["t2"]],
    ]);
    expect(nextGrouped?.[0]?.tasks[1]).toEqual(patched);
    expect(nextGrouped?.[1]).toBe(doneGroup);

    const nextTable = qc.getQueryData<typeof table>(taskKeys.tableRows("ws1", "h"));
    expect(nextTable?.rows[1]).toEqual({ task: patched, direct_child_count: 2 });
    expect(nextTable?.rows[0]).toBe(otherTableRow);
    expect(nextTable?.query_fingerprint).toBe("f");
  });

  it("leaves a row at another revision, and every entry without the task, untouched", () => {
    const qc = new QueryClient();
    const entries: [readonly unknown[], unknown][] = [
      [taskKeys.list("ws1"), [other, task({ revision: 6 })]],
      [taskKeys.query("ws1", "h"), page([task({ revision: 7, title: "Tiêu đề mới" })])],
      [taskKeys.queryInfinite("ws1", "h"), { pages: [page([other]), page([third], 50)], pageParams: [0, 50] }],
      [taskKeys.myTasksFiltered("ws1", "h"), page([other])],
      [taskKeys.myTasksInfinite("ws1", "h"), { pages: [page([task({ revision: 4 })])], pageParams: [0] }],
      [taskKeys.grouped("ws1", "h"), [{ key: "todo", tasks: [other] }]],
      [taskKeys.tableRows("ws1", "h"), { query_fingerprint: "f", total: 1, branch_total: 1, rows: [{ task: other, direct_child_count: 0 }] }],
      [taskKeys.tableGroups("ws1", "h"), { groups: [{ key: "todo", count: 1 }] }],
      [taskKeys.list("ws2"), [task()]],
      [taskKeys.children("t0"), [task()]],
    ];
    for (const [key, data] of entries) qc.setQueryData(key, data);
    // Marked invalidated first: a rewrite of any entry, even with the same
    // data, would clear the flag, so the flag proves nothing was written.
    void qc.invalidateQueries();
    expect(applyTaskPatchFrame(qc, "ws1", statusFrame())).toEqual({ detailPatched: false });
    for (const [key, data] of entries) {
      expect(qc.getQueryData(key)).toBe(data);
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("patches list rows while a detail entry at another revision is left to its refetch", () => {
    const behind = task({ revision: 4 });
    const qc = new QueryClient();
    qc.setQueryData(taskKeys.detail("t1"), behind);
    qc.setQueryData(taskKeys.list("ws1"), [task()]);
    expect(applyTaskPatchFrame(qc, "ws1", statusFrame())).toEqual({ detailPatched: false });
    expect(qc.getQueryData(taskKeys.detail("t1"))).toBe(behind);
    expect(qc.getQueryData(taskKeys.list("ws1"))).toEqual([patched]);
  });

  it("skips entries that have not loaded and shapes it does not know", () => {
    const qc = new QueryClient();
    void qc.prefetchQuery({ queryKey: taskKeys.query("ws1", "pending"), queryFn: () => new Promise(() => {}) });
    const odd: [readonly unknown[], unknown][] = [
      [taskKeys.query("ws1", "null"), null],
      [taskKeys.queryInfinite("ws1", "bad"), { pages: "nope" }],
      [taskKeys.myTasksFiltered("ws1", "bad"), { tasks: "nope" }],
      [taskKeys.list("ws1"), { tasks: [task()] }],
      [taskKeys.grouped("ws1", "bad"), [null, { key: "todo" }]],
      [taskKeys.tableRows("ws1", "bad"), { rows: [null, { direct_child_count: 1 }] }],
    ];
    for (const [key, data] of odd) qc.setQueryData(key, data);
    expect(() => applyTaskPatchFrame(qc, "ws1", statusFrame())).not.toThrow();
    expect(qc.getQueryData(taskKeys.query("ws1", "pending"))).toBeUndefined();
    for (const [key, data] of odd) expect(qc.getQueryData(key)).toBe(data);
  });
});
