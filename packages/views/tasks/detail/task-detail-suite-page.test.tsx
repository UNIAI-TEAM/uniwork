import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { setSessionUser, resetAuthStoreForTests, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { CoreProvider, defaultStorage } from "@uniwork/core/platform";
import { configureShortcutPlatform, useShortcutStore } from "@uniwork/core/shortcuts";
import { useRecentTasksStore } from "@uniwork/core/tasks/stores/recent-tasks-store";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { TaskDetailSuitePage } from "./task-detail-suite-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
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
  organization_slug: "org",
  organization_name: "Org",
};

const task = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "w1",
  number: 12,
  identifier: "TEAM-12",
  revision: 3,
  title: "Ship detail shell",
  description: "TipTap title and body",
  status: "todo",
  priority: "medium",
  position: 1,
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function shell(ui: React.ReactElement) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p === "/api/v1/tasks/t1") {
      return Promise.resolve({ task });
    }
    return Promise.resolve({});
  });
});

describe("TaskDetailSuitePage", () => {
  it("renders title region and properties sidebar landmark", async () => {
    render(
      shell(
        <TaskDetailSuitePage workspaceId="w1" taskId="t1" />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("Ship detail shell")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("region", { name: /tiêu đề|title/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: /thuộc tính|properties/i }),
    ).toBeInTheDocument();

    const sidebarToggle = screen.getByRole("button", {
      name: /hiện hoặc ẩn thuộc tính|show or hide properties/i,
    });
    expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(sidebarToggle);
    await waitFor(() => {
      expect(sidebarToggle).toHaveAttribute("aria-expanded", "false");
    });
  });

  // `send` has a default chord, but the description editor has no `onSubmit`
  // (task-detail-editors.tsx), so the chord must not submit anything.
  it("does not submit on primary+Enter in the description editor", async () => {
    configureShortcutPlatform("windows");
    useShortcutStore.getState().resetAll();
    const writes = () =>
      requestMock.mock.calls.filter(([, opts]) => {
        const method = (opts as { method?: string } | undefined)?.method;
        return method !== undefined && method !== "GET";
      });
    try {
      const { container, unmount } = render(
        shell(<TaskDetailSuitePage workspaceId="w1" taskId="t1" />),
      );
      const surface = await waitFor(() => {
        const el = Array.from(
          container.querySelectorAll<HTMLElement>(".ProseMirror[contenteditable='true']"),
        ).find((node) => node.textContent?.includes("TipTap title and body"));
        expect(el).toBeTruthy();
        return el as HTMLElement;
      });

      fireEvent.keyDown(surface, { key: "Enter", ctrlKey: true });

      // The send handler passed on the chord, so TipTap's own HardBreak
      // binding (Mod-Enter) took it — the same thing that happened before
      // `send` had a default. Had a submit handler consumed it, no break.
      expect(
        surface.querySelector("br:not(.ProseMirror-trailingBreak)"),
      ).not.toBeNull();
      expect(surface.textContent).toBe("TipTap title and body");
      expect(writes()).toEqual([]);

      // The break is an edit, so it armed the description's 1500ms autosave,
      // and this test used to end with that timer pending. Unmount here rather
      // than in the shared cleanup: unmounting clears the timer and flushes
      // what it held (`flushPendingOnUnmount`), and the settle lets any save
      // that flush starts reach the transport. The break sits at the start of
      // the paragraph and serializes to the same markdown, so there is nothing
      // to save; were there, it would fail here instead of landing as a stray
      // request inside a later test.
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(writes()).toEqual([]);
    } finally {
      configureShortcutPlatform(null);
    }
  });
});

describe("TaskDetailSuitePage recent tasks", () => {
  const recentIds = () =>
    (useRecentTasksStore.getState().byWorkspace.w1 ?? []).map((entry) => entry.id);

  /** t1 recorded first, t9 after it, so the list reads newest first. */
  function seedRecent() {
    const record = useRecentTasksStore.getState().recordVisit;
    record("w1", { id: "t1", identifier: "TEAM-12", title: "Ship detail shell" });
    record("w1", { id: "t9", identifier: "TEAM-99", title: "Another task" });
  }

  function failTaskWith(error: unknown) {
    requestMock.mockImplementation((path: unknown) =>
      String(path) === "/api/v1/tasks/t1" ? Promise.reject(error) : Promise.resolve({}),
    );
  }

  beforeEach(() => {
    useRecentTasksStore.setState({ byWorkspace: {} });
  });

  it("ghi task vào danh sách xem gần đây khi tải thành công", async () => {
    render(shell(<TaskDetailSuitePage workspaceId="w1" taskId="t1" />));
    await screen.findByText("Ship detail shell");

    await waitFor(() =>
      expect(useRecentTasksStore.getState().byWorkspace.w1).toEqual([
        { id: "t1", identifier: "TEAM-12", title: "Ship detail shell", visitedAt: expect.any(Number) },
      ]),
    );
  });

  it("task trả 404 bị gỡ khỏi danh sách gần đây và không được ghi lại", async () => {
    seedRecent();
    failTaskWith(new ApiError("not found", "not_found", 404));

    render(shell(<TaskDetailSuitePage workspaceId="w1" taskId="t1" />));
    await screen.findByText("Không tìm thấy công việc");

    await waitFor(() => expect(recentIds()).toEqual(["t9"]));
  });

  // The page shows "not found" for every failure; only a real 404 means the
  // task is gone. A dropped connection must not erase the person's history.
  it("lỗi mạng giữ task trong danh sách gần đây", async () => {
    seedRecent();
    failTaskWith(new TypeError("Failed to fetch"));

    render(shell(<TaskDetailSuitePage workspaceId="w1" taskId="t1" />));
    await screen.findByText("Không tìm thấy công việc");

    expect(recentIds()).toEqual(["t9", "t1"]);
  });

  // Logout does not unmount the page synchronously, and the task query that
  // was already in flight still resolves: that visit must not re-persist a
  // title the logout cleanup just removed.
  it("task tải xong sau khi đã đăng xuất: không ghi vào danh sách gần đây", async () => {
    let resolveTask: (value: unknown) => void = () => {};
    requestMock.mockImplementation((path: unknown) =>
      String(path) === "/api/v1/tasks/t1"
        ? new Promise((resolve) => {
            resolveTask = resolve;
          })
        : Promise.resolve({}),
    );
    render(
      <CoreProvider>
        <div />
      </CoreProvider>,
    );
    render(shell(<TaskDetailSuitePage workspaceId="w1" taskId="t1" />));
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/tasks/t1")).toBe(true),
    );

    await act(async () => {
      await useAuthStore.getState().logout();
    });
    await act(async () => {
      resolveTask({ task });
    });
    await screen.findByText("Ship detail shell");

    expect(useRecentTasksStore.getState().byWorkspace).toEqual({});
    expect(defaultStorage.getItem("uniwork_recent_tasks") ?? "").not.toContain("Ship detail shell");
  });

  it("lỗi 500 giữ task trong danh sách gần đây", async () => {
    seedRecent();
    failTaskWith(new ApiError("boom", "internal", 500));

    render(shell(<TaskDetailSuitePage workspaceId="w1" taskId="t1" />));
    await screen.findByText("Không tìm thấy công việc");

    expect(recentIds()).toEqual(["t9", "t1"]);
  });
});
