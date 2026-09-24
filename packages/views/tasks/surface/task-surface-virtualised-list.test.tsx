import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { taskKeys } from "@uniwork/core/tasks";
import { requestMock, wrap } from "../../test/api-mock";
import { TaskSurface } from "./task-surface";

// jsdom has no layout, so the real Virtuoso renders an empty window. This one
// renders every row and models react-virtuoso 4.18.13 `endReached`: it fires
// when the last item is in the rendered range, again whenever `[lastIndex, data]`
// changes by identity. Every group's end counts as in range, the worst case a
// user can scroll into, so a page landing (which rebuilds each group's array)
// would fire it again.
vi.mock("react-virtuoso", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-virtuoso")>();
  const React = await import("react");
  function Virtuoso(props: {
    data: Array<{ id: string }>;
    itemContent: (index: number, item: { id: string }) => React.ReactNode;
    computeItemKey?: (index: number, item: { id: string }) => string;
    endReached?: (index: number) => void;
  }) {
    const last = React.useRef<[number, unknown] | null>(null);
    React.useEffect(() => {
      const { data, endReached } = props;
      if (!data.length) return;
      const next: [number, unknown] = [data.length - 1, data];
      if (last.current && last.current[0] === next[0] && last.current[1] === next[1]) return;
      last.current = next;
      endReached?.(data.length - 1);
    });
    return (
      <div data-testid="fake-virtuoso">
        {props.data.map((item, index) => (
          <div key={props.computeItemKey ? props.computeItemKey(index, item) : index}>
            {props.itemContent(index, item)}
          </div>
        ))}
      </div>
    );
  }
  return { ...actual, Virtuoso };
});

initI18n();

// 55 backlog rows, so the backlog group passes the 50-row virtualization
// threshold as soon as the second page lands; the rest fill todo.
const backlogFirst = (index: number) => (index < 55 ? "backlog" : "todo");

const row = (index: number, statusOf: (index: number) => string) => ({
  id: `t${index}`,
  workspace_id: "w1",
  title: `Task ${index}`,
  description: "",
  status: statusOf(index),
  priority: "medium",
  position: index,
  created_by: "u1",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
});

/** `total` tasks behind `/tasks/query`, 50 per page; records every requested offset. */
function serveTasks(total: number, statusOf: (index: number) => string = backlogFirst) {
  const offsets: number[] = [];
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    if (typeof path !== "string" || !path.includes("/tasks/query")) {
      return { tasks: [], total: 0, limit: 50, offset: 0 };
    }
    const body = (init?.body ?? {}) as { offset?: number; limit?: number };
    const offset = Number(body.offset ?? 0);
    const limit = Number(body.limit ?? 50);
    offsets.push(offset);
    const count = Math.max(0, Math.min(limit, total - offset));
    return {
      tasks: Array.from({ length: count }, (_, k) => row(offset + k, statusOf)),
      total,
      limit,
      offset,
    };
  });
  return offsets;
}

const listRows = () => document.querySelectorAll("[data-task-list-row]").length;
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Invalidate() {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      aria-label="realtime refetch"
      onClick={() => void qc.invalidateQueries({ queryKey: taskKeys.queryRoot("w1") })}
    />
  );
}

describe("TaskSurface list with a virtualised group", () => {
  beforeEach(() => {
    // Keep the footer sentinel inert: the load-more button is the only trigger here.
    vi.stubGlobal("IntersectionObserver", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** One click, then one realtime refetch: exactly one page each way, no auto-loaded pages. */
  async function expectOnePagePerLoadMore(offsets: number[], surfaceKey: string) {
    render(
      wrap(
        <>
          <Invalidate />
          <TaskSurface
            workspaceId="w1"
            scope={{ type: "workspace" }}
            modes={["list"]}
            surfaceKey={surfaceKey}
          />
        </>,
      ),
    );
    await waitFor(() => expect(listRows()).toBe(50));

    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    await waitFor(() => expect(listRows()).toBe(100));
    // A group is virtualised now and its end is in range.
    expect(screen.getAllByTestId("fake-virtuoso").length).toBeGreaterThan(0);
    await settle(300);
    expect(offsets).toEqual([0, 50]);
    expect(listRows()).toBe(100);

    // A task event refetches the two loaded pages and rebuilds every group's array.
    fireEvent.click(screen.getByRole("button", { name: "realtime refetch" }));
    await waitFor(() => expect(offsets).toEqual([0, 50, 0, 50]));
    await settle(500);
    expect(offsets).toEqual([0, 50, 0, 50]);
    expect(listRows()).toBe(100);
  }

  it("one load more asks for exactly one more page, and a realtime refetch asks for none", async () => {
    await expectOnePagePerLoadMore(serveTasks(300), "test-virtualised-list");
  }, 30_000);

  it("holds when the virtualised group is the last group on the list", async () => {
    // 45 backlog rows stay under the threshold; cancelled, the last status
    // group, passes it once the second page lands. Wiring endReached on the
    // last group alone would fire here.
    const offsets = serveTasks(300, (index) => (index < 45 ? "backlog" : "cancelled"));
    await expectOnePagePerLoadMore(offsets, "test-virtualised-list-last");
  }, 30_000);
});
