import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  useResolvedExpandedThreads,
  useSubtasksCollapsed,
  useTaskDetailUiStore,
} from "./task-detail-ui-store";

const store = () => useTaskDetailUiStore.getState();

beforeEach(() => {
  useTaskDetailUiStore.setState({ tasks: {} });
});

describe("task detail UI store", () => {
  it("nhớ luồng đã giải quyết đang mở theo từng task", () => {
    store().setResolvedExpanded("t1", "c1", true);
    store().setResolvedExpanded("t1", "c2", true);
    store().setResolvedExpanded("t1", "c1", false);

    expect(store().isResolvedExpanded("t1", "c1")).toBe(false);
    expect(store().isResolvedExpanded("t1", "c2")).toBe(true);
    expect(store().isResolvedExpanded("t2", "c2")).toBe(false);
  });

  it("nhớ sub-task đang gấp theo từng task", () => {
    store().setSubtasksCollapsed("t1", true);

    expect(store().isSubtasksCollapsed("t1")).toBe(true);
    expect(store().isSubtasksCollapsed("t2")).toBe(false);

    store().setSubtasksCollapsed("t1", false);
    expect(store().isSubtasksCollapsed("t1")).toBe(false);
  });

  it("không giữ mục cho task đã trở về mặc định, để store khỏi phình", () => {
    store().setResolvedExpanded("t1", "c1", true);
    store().setSubtasksCollapsed("t1", true);
    store().setResolvedExpanded("t1", "c1", false);
    store().setSubtasksCollapsed("t1", false);

    expect(Object.keys(store().tasks)).toEqual([]);
  });

  it("đặt lại cùng một giá trị không đổi state", () => {
    store().setResolvedExpanded("t1", "c1", true);
    const before = store().tasks;

    store().setResolvedExpanded("t1", "c1", true);
    store().setSubtasksCollapsed("t2", false);

    expect(store().tasks).toBe(before);
  });

  it("nhớ tối đa 200 task, bỏ task được đụng tới lâu nhất", () => {
    for (let i = 0; i < 200; i += 1) {
      store().setSubtasksCollapsed(`task-${i}`, true);
    }
    // Touching the oldest task makes it the newest, so task-1 is now oldest.
    store().setResolvedExpanded("task-0", "c1", true);
    store().setSubtasksCollapsed("task-new", true);

    const ids = Object.keys(store().tasks);
    expect(ids).toHaveLength(200);
    expect(ids).not.toContain("task-1");
    expect(ids).toContain("task-0");
    expect(ids).toContain("task-new");
  });

  it("bỏ dữ liệu lưu hỏng khi nạp, không ném lỗi", () => {
    const { merge } = useTaskDetailUiStore.persist.getOptions();
    const current = store();

    expect(merge?.("not an object", current).tasks).toEqual({});
    expect(merge?.({ tasks: ["t1"] }, current).tasks).toEqual({});

    const merged = merge?.(
      {
        tasks: {
          good: { resolvedExpanded: ["c1", 7, "c2"], subtasksCollapsed: true, touchedAt: 5 },
          noTouch: { resolvedExpanded: ["c1"], subtasksCollapsed: false },
          badList: { resolvedExpanded: "c1", subtasksCollapsed: true, touchedAt: 1 },
          badFlag: { resolvedExpanded: ["c1"], subtasksCollapsed: "yes", touchedAt: 1 },
          empty: { resolvedExpanded: [], subtasksCollapsed: false, touchedAt: 1 },
          nope: null,
        },
      },
      current,
    );

    expect(merged?.tasks).toEqual({
      good: { resolvedExpanded: ["c1", "c2"], subtasksCollapsed: true, touchedAt: 5 },
      noTouch: { resolvedExpanded: ["c1"], subtasksCollapsed: false, touchedAt: 0 },
    });
    expect(merged?.setResolvedExpanded).toBe(current.setResolvedExpanded);
  });

  it("cắt dữ liệu lưu quá 200 task khi nạp, giữ những task mới nhất", () => {
    const { merge } = useTaskDetailUiStore.persist.getOptions();
    const tasks: Record<string, unknown> = {};
    for (let i = 0; i < 205; i += 1) {
      tasks[`task-${i}`] = { resolvedExpanded: [], subtasksCollapsed: true, touchedAt: 1000 - i };
    }

    const ids = Object.keys(merge?.({ tasks }, store()).tasks ?? {});

    expect(ids).toHaveLength(200);
    expect(ids).toContain("task-0");
    expect(ids).not.toContain("task-204");
  });

  // Each id is a ULID, so an uncapped list read from storage is unbounded
  // memory and an O(n) `includes` on every timeline render.
  it("cắt danh sách luồng đang mở quá 200 id khi nạp, giữ những luồng mở sau cùng", () => {
    const { merge } = useTaskDetailUiStore.persist.getOptions();
    const resolvedExpanded = Array.from({ length: 5000 }, (_, i) => `c${i}`);

    const merged = merge?.(
      { tasks: { t1: { resolvedExpanded, subtasksCollapsed: false, touchedAt: 1 } } },
      store(),
    );

    const ids = merged?.tasks.t1?.resolvedExpanded ?? [];
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe("c4800");
    expect(ids.at(-1)).toBe("c4999");
  });

  it("mở quá 200 luồng đã giải quyết trong một task thì bỏ luồng mở sớm nhất", () => {
    for (let i = 0; i <= 200; i += 1) {
      store().setResolvedExpanded("t1", `c${i}`, true);
    }

    const ids = store().tasks.t1?.resolvedExpanded ?? [];
    expect(ids).toHaveLength(200);
    expect(store().isResolvedExpanded("t1", "c0")).toBe(false);
    expect(store().isResolvedExpanded("t1", "c1")).toBe(true);
    expect(store().isResolvedExpanded("t1", "c200")).toBe(true);
  });
});

describe("task detail UI hooks", () => {
  it("trả cùng tham chiếu giữa các lần render khi không đổi, kể cả task chưa có gì", () => {
    let renders = 0;
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) => {
        renders += 1;
        return useResolvedExpandedThreads(taskId);
      },
      { initialProps: { taskId: "t1" } },
    );
    const first = result.current;

    rerender({ taskId: "t1" });
    expect(result.current).toBe(first);
    expect(result.current).toEqual([]);

    act(() => store().setResolvedExpanded("t1", "c1", true));
    const expanded = result.current;
    expect(expanded).toEqual(["c1"]);

    rerender({ taskId: "t1" });
    expect(result.current).toBe(expanded);
    // Mount, rerender, store change, rerender. A selector that builds a fresh
    // array on each call would loop (or throw "getSnapshot should be cached").
    expect(renders).toBe(4);
  });

  it("một thay đổi ở task khác không render lại người đọc của task này", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return [useResolvedExpandedThreads("t1"), useSubtasksCollapsed("t1")];
    });
    expect(renders).toBe(1);

    act(() => {
      store().setResolvedExpanded("t2", "c9", true);
      store().setSubtasksCollapsed("t2", true);
    });

    expect(renders).toBe(1);
  });

  it("useSubtasksCollapsed đọc trạng thái gấp của đúng task", () => {
    const { result } = renderHook(() => useSubtasksCollapsed("t1"));
    expect(result.current).toBe(false);

    act(() => store().setSubtasksCollapsed("t1", true));
    expect(result.current).toBe(true);
  });
});
