import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { paths } from "@uniwork/core/paths";
import { useSearchStore } from "@uniwork/core/search";
import { useRecentTasksStore } from "@uniwork/core/tasks/stores/recent-tasks-store";
import type { User, Workspace } from "@uniwork/core/types";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import type { NavigationAdapter } from "../navigation";
import { SearchCommand } from "./search-command";

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const localeAdapter = {
  getUserChoice: () => "vi",
  getSystemPreferences: () => ["vi"],
  persist: vi.fn(),
};

beforeEach(() => {
  resetAuthStoreForTests();
  // Recent tasks are only recorded while someone is signed in.
  setSessionUser(user);
  useSearchStore.setState({ open: false });
  useRecentTasksStore.setState({ byWorkspace: {} });
  localeAdapter.persist.mockClear();
  requestMock.mockReset();
});

const RECENT = "Gần đây";
const DOCUMENTS_GROUP = "Tài liệu";

function docRow(wsId: string, over: Record<string, unknown> = {}) {
  return {
    id: "doc1",
    workspace_id: wsId,
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "1",
    ...over,
  };
}

function paletteTree(workspaceValue: Workspace, documentsOn = false) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: documentsOn } }));
  return (
    <FeatureFlagsProvider service={service}>
      <ThemeProvider>
        <LocaleAdapterProvider adapter={localeAdapter}>
          <WorkspaceProvider workspace={workspaceValue} user={user}>
            <SearchCommand onCreateTask={() => {}} />
          </WorkspaceProvider>
        </LocaleAdapterProvider>
      </ThemeProvider>
    </FeatureFlagsProvider>
  );
}

function renderPalette(documentsOn = false) {
  const nav: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
  render(wrapWithNav(paletteTree(workspace, documentsOn), nav));
  return nav;
}

/** Like renderPalette, but returns the render handle so a test can rerender. */
function renderPaletteWithHandle(workspaceValue: Workspace) {
  const nav: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
  return { nav, ...render(wrapWithNav(paletteTree(workspaceValue, true), nav)) };
}

/** Oldest first, so `t${count - 1}` is the most recent visit. */
function seedRecent(count: number, workspaceId = workspace.id) {
  for (let i = 0; i < count; i += 1) {
    useRecentTasksStore
      .getState()
      .recordVisit(workspaceId, { id: `t${i}`, identifier: `TEAM-${i}`, title: `Task t${i}` });
  }
}

function openPalette() {
  act(() => useSearchStore.getState().setOpen(true));
}

describe("SearchCommand recent tasks", () => {
  it("khi ô tìm rỗng, hiện tối đa 5 task xem gần đây của workspace, mới nhất trước", () => {
    seedRecent(6);
    renderPalette();
    openPalette();

    const group = screen.getByRole("group", { name: RECENT });
    const options = within(group).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "TEAM-5Task t5",
      "TEAM-4Task t4",
      "TEAM-3Task t3",
      "TEAM-2Task t2",
      "TEAM-1Task t1",
    ]);
  });

  it("chọn một task gần đây thì đóng palette và điều hướng tới task đó", () => {
    seedRecent(2);
    const nav = renderPalette();
    openPalette();

    fireEvent.click(within(screen.getByRole("group", { name: RECENT })).getByText("Task t1"));

    expect(nav.push).toHaveBeenCalledWith(paths.workspace("acme", "team").task("t1"));
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("có truy vấn thì ẩn nhóm gần đây, kể cả khi truy vấn khớp tiêu đề một task gần đây", () => {
    seedRecent(2);
    renderPalette();
    openPalette();

    fireEvent.change(screen.getByPlaceholderText("Gõ trang hoặc lệnh…"), {
      target: { value: "Task t1" },
    });

    expect(screen.queryByRole("group", { name: RECENT })).toBeNull();
    expect(screen.queryByText("Task t1")).toBeNull();
  });

  it("đóng palette từ bên ngoài rồi mở lại thì ô tìm trống và nhóm gần đây hiện lại", () => {
    seedRecent(1);
    renderPalette();
    openPalette();
    fireEvent.change(screen.getByPlaceholderText("Gõ trang hoặc lệnh…"), {
      target: { value: "cai dat" },
    });
    expect(screen.queryByRole("group", { name: RECENT })).toBeNull();

    // The global ⌘K toggle closes through the store, not through the dialog.
    act(() => useSearchStore.getState().setOpen(false));
    openPalette();

    expect(screen.getByPlaceholderText("Gõ trang hoặc lệnh…")).toHaveValue("");
    expect(screen.getByRole("group", { name: RECENT })).toBeInTheDocument();
  });

  it("không hiện nhóm gần đây khi workspace này chưa xem task nào, dù workspace khác có", () => {
    seedRecent(2, "another-workspace");
    renderPalette();
    openPalette();

    expect(screen.getByText("Công việc")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: RECENT })).toBeNull();
    expect(screen.queryByText("Task t1")).toBeNull();
  });
});

describe("SearchCommand documents group", () => {
  it("lists recently opened documents and navigates to the chosen one", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`/api/v1/workspaces/${workspace.id}/documents/recent`)) {
        return Promise.resolve({ documents: [docRow(workspace.id)], next_cursor: null });
      }
      return Promise.resolve({});
    });
    const nav = renderPalette(true);
    openPalette();

    const group = await screen.findByRole("group", { name: DOCUMENTS_GROUP });
    expect(within(group).getByText("Kế hoạch Q4")).toBeInTheDocument();

    fireEvent.click(within(group).getByText("Kế hoạch Q4"));

    expect(nav.push).toHaveBeenCalledWith(paths.workspace("acme", "team").document("doc1"));
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("debounces the search by 250 ms and asks the workspace-scoped list endpoint", async () => {
    const urls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.includes("/documents?")) {
        urls.push(path);
        return Promise.resolve({ documents: [docRow(workspace.id)], next_cursor: null });
      }
      return Promise.resolve({});
    });
    renderPalette(true);
    openPalette();
    const input = screen.getByPlaceholderText("Gõ trang hoặc lệnh…");

    // Fake timers only around the debounce; everything before it already
    // settled under real timers.
    vi.useFakeTimers();
    try {
      fireEvent.change(input, { target: { value: "kế" } });
      expect(urls).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(249);
      });
      expect(urls).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(1);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(urls).toHaveLength(1);
    const [path] = urls;
    expect(path?.startsWith(`/api/v1/workspaces/${workspace.id}/documents?`)).toBe(true);
    expect(new URLSearchParams(path?.split("?")[1] ?? "").get("q")).toBe("kế");
  });

  it("drops the term and the hits when the workspace switches", async () => {
    const other: Workspace = { ...workspace, id: "ws2", slug: "other", name: "Other" };
    requestMock.mockImplementation((path: string) => {
      if (path.includes("/documents/")) return Promise.resolve({ documents: [], next_cursor: null });
      if (path.includes("/documents?")) {
        return Promise.resolve({ documents: [docRow(workspace.id)], next_cursor: null });
      }
      return Promise.resolve({});
    });
    const { nav, rerender } = renderPaletteWithHandle(workspace);
    openPalette();

    fireEvent.change(screen.getByPlaceholderText("Gõ trang hoặc lệnh…"), {
      target: { value: "kế" },
    });
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();

    // Switch workspace while the palette stays open: the term resets, and the
    // answer fetched for the old workspace never renders for the new one
    // (recent for ws2 is empty and no scoped list query was left behind).
    rerender(wrapWithNav(paletteTree(other, true), nav));

    expect(screen.getByPlaceholderText("Gõ trang hoặc lệnh…")).toHaveValue("");
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();
  });

  it("never calls the documents endpoints when the flag is off", async () => {
    requestMock.mockImplementation(() => Promise.resolve({}));
    renderPalette(false);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText("Gõ trang hoặc lệnh…"), {
      target: { value: "kế" },
    });
    await new Promise((resolve) => setTimeout(resolve, 320));
    const documentCalls = requestMock.mock.calls.filter(([path]) =>
      String(path).includes("/documents"),
    );
    expect(documentCalls).toEqual([]);
  });
});

describe("SearchCommand", () => {
  it("opens from the store and lists workspace pages", () => {
    useSearchStore.setState({ open: true });
    render(wrapWithNav(paletteTree(workspace)));
    expect(screen.getByPlaceholderText("Gõ trang hoặc lệnh…")).toBeInTheDocument();
    expect(screen.getByText("Công việc")).toBeInTheDocument();
    expect(screen.getByText("Cuộc họp")).toBeInTheDocument();
    expect(screen.getByText("Cài đặt")).toBeInTheDocument();
  });
});
