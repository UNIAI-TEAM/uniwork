import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { TableGrouping } from "@uniwork/core/tasks/stores/view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import { serveBoardTable } from "../../test/board-table-server";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { TaskSurface } from "../surface/task-surface";
import { useTableViewData } from "./use-table-view-data";

// Switching to the table froze the whole app: useQueries handed back a new
// array on every render, so displayRows was rebuilt, TanStack Table recomputed
// its row model and auto-reset pagination into its own useState, which
// rendered again — forever, one microtask at a time, with no React error.

initI18n();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const user: User = {
  id: "u1",
  email: "an@example.com",
  display_name: "An Nguyễn",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const nav: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/",
  searchParams: new URLSearchParams(),
  getShareableUrl: (path) => path,
};

const settle = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

let storeCount = 0;

describe.each<TableGrouping>(["none", "status"])("table view with grouping %s", (grouping) => {
  it("keeps displayRows when nothing it reads has changed", async () => {
    serveBoardTable({ counts: { todo: 3, done: 2 } });
    storeCount += 1;
    const store = getTaskSurfaceViewStore(`table-render-loop-hook-${storeCount}`);
    store.getState().setTableGrouping(grouping);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <ViewStoreProvider store={store}>{children}</ViewStoreProvider>
        </QueryClientProvider>
      );
    }
    const { result, rerender } = renderHook(() => useTableViewData({ workspaceId: "w1" }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.loadedTasks).toHaveLength(5));

    const before = result.current.displayRows;
    rerender();
    expect(result.current.displayRows).toBe(before);
  });

  it("stops rendering once its data has arrived", async () => {
    serveBoardTable({ counts: { todo: 3, done: 2 } });
    storeCount += 1;
    const surfaceKey = `table-render-loop-${storeCount}`;
    getTaskSurfaceViewStore(surfaceKey).getState().setTableGrouping(grouping);
    let commits = 0;
    render(
      wrap(
        <NavigationProvider value={nav}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <Profiler id="surface" onRender={() => (commits += 1)}>
              <TaskSurface
                workspaceId="w1"
                scope={{ type: "workspace" }}
                modes={["table"]}
                surfaceKey={surfaceKey}
              />
            </Profiler>
          </WorkspaceProvider>
        </NavigationProvider>,
      ),
    );
    await screen.findByText("todo 0");
    await settle(200);

    const settled = commits;
    await settle(300);
    expect(commits - settled).toBe(0);
  });
});
