import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import type { TableRowsResult } from "@uniwork/core/api/endpoints/tasks-table";
import { taskKeys } from "@uniwork/core/tasks";
import { tableRowsPageBody, tableRowsPageQuery } from "@uniwork/core/tasks/surface/table-query";
import type { Task, TaskLabel } from "@uniwork/core/types";
import { requestMock } from "../../test/api-mock";
import { useTaskLabelToggle } from "./use-task-label-toggle";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const WS = "w1";

function label(id: string, name: string, color: string): TaskLabel {
  return {
    id,
    organization_id: "o1",
    workspace_id: WS,
    name,
    description: "",
    color,
    usage_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

const bug = label("l1", "Bug", "#ef4444");
const catalog = [bug, label("l2", "Frontend", "#3b82f6")];
/** What a row's `labels` array holds — `{id, name, color}`, not the full catalog record. */
const bugRowLabel = { id: bug.id, name: bug.name, color: bug.color };

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    organization_id: "o1",
    workspace_id: WS,
    number: 1,
    identifier: id,
    revision: 1,
    title: id,
    description: "",
    status: "todo",
    priority: "medium",
    assignee_kind: "human",
    position: 1,
    kind: "normal",
    created_by: "u1",
    created_by_kind: "human",
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    ...over,
  };
}

/** The key one cached table-rows page sits under, built by the real body/key builders. */
function rowsKey() {
  return tableRowsPageQuery(
    WS,
    tableRowsPageBody({
      query: {},
      groupBy: "none",
      hierarchy: false,
      groupKey: null,
      parentId: null,
      cursor: null,
      limit: 50,
    }),
  ).queryKey;
}

function rowsPage(rows: TableRowsResult["rows"]): TableRowsResult {
  return {
    query_fingerprint: "f",
    group_key: null,
    parent_id: null,
    total: rows.length,
    rows,
    next_cursor: null,
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const rowsOf = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryData<TableRowsResult>(key);

/** Holds the mocked transport's next call open until `release()`. */
function holdRequest() {
  let release: () => void = () => undefined;
  const held = new Promise<undefined>((resolve) => {
    release = () => resolve(undefined);
  });
  requestMock.mockImplementation(() => held);
  return release;
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue(undefined);
  vi.mocked(toast.error).mockReset();
});

describe("useTaskLabelToggle", () => {
  const key = rowsKey();

  it("gắn nhãn cập nhật labels trong mọi trang rows cache ngay, trước khi request hoàn tất", async () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([{ task: task("t1"), direct_child_count: 0, labels: [] }]));
    const release = holdRequest();
    const { result } = renderHook(() => useTaskLabelToggle(WS, "t1", catalog), { wrapper: wrapperFor(qc) });

    act(() => result.current.toggle("l1", true));

    await waitFor(() => expect(rowsOf(qc, key)?.rows[0]?.labels).toEqual([bugRowLabel]));

    release();
    await waitFor(() => expect(result.current.pendingIds.has("l1")).toBe(false));
  });

  it("hủy lượt tải rows đang chạy trước khi ghi lạc quan, để kết quả cũ không đè nhãn vừa gắn", async () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([{ task: task("t1"), direct_child_count: 0, labels: [] }]));
    let answerFetch: (page: TableRowsResult) => void = () => undefined;
    void qc
      .fetchQuery({
        queryKey: key,
        queryFn: () =>
          new Promise<TableRowsResult>((resolve) => {
            answerFetch = resolve;
          }),
      })
      .catch(() => undefined);
    const release = holdRequest();
    const { result } = renderHook(() => useTaskLabelToggle(WS, "t1", catalog), { wrapper: wrapperFor(qc) });

    act(() => result.current.toggle("l1", true));
    await waitFor(() => expect(rowsOf(qc, key)?.rows[0]?.labels).toEqual([bugRowLabel]));

    // The fetch started before the toggle answers with the old labels.
    await act(async () => {
      answerFetch(rowsPage([{ task: task("t1"), direct_child_count: 0, labels: [] }]));
      await Promise.resolve();
    });
    expect(rowsOf(qc, key)?.rows[0]?.labels).toEqual([bugRowLabel]);

    release();
    await waitFor(() => expect(result.current.pendingIds.has("l1")).toBe(false));
  });

  it("gắn nhãn chèn đúng vị trí theo tên (không phân biệt hoa thường), không phá nhãn khác", async () => {
    const qc = newClient();
    const zulu = label("l9", "Zulu", "#000000");
    qc.setQueryData(key, rowsPage([{ task: task("t1"), direct_child_count: 0, labels: [zulu] }]));
    const { result } = renderHook(() => useTaskLabelToggle(WS, "t1", [...catalog, zulu]), {
      wrapper: wrapperFor(qc),
    });

    act(() => result.current.toggle("l1", true));

    await waitFor(() => expect(rowsOf(qc, key)?.rows[0]?.labels).toEqual([bugRowLabel, zulu]));
  });

  it("gỡ nhãn xoá khỏi mọi trang rows cache ngay, trước khi request hoàn tất", async () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([{ task: task("t1"), direct_child_count: 0, labels: [bug] }]));
    const release = holdRequest();
    const { result } = renderHook(() => useTaskLabelToggle(WS, "t1", catalog), { wrapper: wrapperFor(qc) });

    act(() => result.current.toggle("l1", false));

    await waitFor(() => expect(rowsOf(qc, key)?.rows[0]?.labels).toEqual([]));
    release();
  });

  it("request thất bại thì khôi phục cache rows và hiện toast lỗi", async () => {
    const qc = newClient();
    const before = rowsPage([{ task: task("t1"), direct_child_count: 0, labels: [] }]);
    qc.setQueryData(key, before);
    requestMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useTaskLabelToggle(WS, "t1", catalog), { wrapper: wrapperFor(qc) });

    act(() => result.current.toggle("l1", true));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(rowsOf(qc, key)).toStrictEqual(before);
  });

  it("gắn thành công thì vẫn invalidate tableRoot của workspace khi request hoàn tất", async () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([{ task: task("t1"), direct_child_count: 0, labels: [] }]));
    const { result } = renderHook(() => useTaskLabelToggle(WS, "t1", catalog), { wrapper: wrapperFor(qc) });

    act(() => result.current.toggle("l1", true));

    await waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("gắn thất bại cũng invalidate tableRoot của workspace khi request hoàn tất", async () => {
    const qc = newClient();
    qc.setQueryData(key, rowsPage([{ task: task("t1"), direct_child_count: 0, labels: [] }]));
    requestMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useTaskLabelToggle(WS, "t1", catalog), { wrapper: wrapperFor(qc) });

    act(() => result.current.toggle("l1", true));

    await waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
