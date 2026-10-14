import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useMemo, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { localeAdapter, requestMock } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;

interface TestNav extends NavigationAdapter {
  subscribe: (listener: () => void) => () => void;
}

/** Stateful navigation adapter test double with history stack (push/replace/back). */
function createTestNav(initialUrl = `/org/${WS}/documents`): TestNav {
  const parse = (href: string) => {
    const [p = "/", s = ""] = href.split("?");
    return { pathname: p || "/", search: s };
  };
  let history = [parse(initialUrl)];
  let index = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    const cur = history[index]!;
    nav.pathname = cur.pathname;
    nav.searchParams = new URLSearchParams(cur.search);
    for (const l of listeners) l();
  };
  const nav: TestNav = {
    pathname: history[0]!.pathname,
    searchParams: new URLSearchParams(history[0]!.search),
    push: vi.fn((href: string) => {
      history = [...history.slice(0, index + 1), parse(href)];
      index = history.length - 1;
      notify();
    }),
    replace: vi.fn((href: string) => {
      history = [...history.slice(0, index), parse(href), ...history.slice(index + 1)];
      notify();
    }),
    back: vi.fn(() => {
      if (index > 0) {
        index -= 1;
        notify();
      }
    }),
    openExternal: vi.fn(),
    getShareableUrl: (p) => p,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return nav;
}

function StatefulNavHost({ nav, children }: { nav: TestNav; children: React.ReactNode }) {
  const [, setTick] = useState(0);
  useEffect(() => nav.subscribe(() => setTick((n) => n + 1)), [nav]);
  const value = useMemo<NavigationAdapter>(
    () => ({
      ...nav,
      pathname: nav.pathname,
      searchParams: nav.searchParams,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nav, nav.pathname, nav.searchParams.toString()],
  );
  return <NavigationProvider value={value}>{children}</NavigationProvider>;
}

function renderWithUrl(initialUrl = `/org/${WS}/documents`) {
  const nav = createTestNav(initialUrl);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LocaleAdapterProvider adapter={localeAdapter}>
        <StatefulNavHost nav={nav}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
          </FeatureFlagsProvider>
        </StatefulNavHost>
      </LocaleAdapterProvider>
    </QueryClientProvider>,
  );
  return { ...view, nav, queryClient };
}

function folderNode(id: string, title: string, children: unknown[] = []) {
  return { id, title, kind: "folder", position: 0, children };
}

function folderDetail(id: string, title: string, over: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: WS,
    kind: "folder",
    title,
    revision: "1",
    my_level: "manage",
    updated_at: "2026-10-14T00:00:00Z",
    breadcrumbs: [],
    ...over,
  };
}

interface Routes {
  tree?: () => unknown[];
  list?: (path: string) => unknown[];
  detail?: (id: string) => unknown;
  post?: (path: string, body: unknown) => unknown;
}

function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    const run = (fn: () => unknown) => {
      try {
        return Promise.resolve(fn());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    if (path.startsWith(TREE_URL)) return run(() => ({ documents: routes.tree?.() ?? [] }));
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      return Promise.resolve({ items: [], next_cursor: null });
    }
    if (method === "POST") return run(() => routes.post?.(path, opts?.body) ?? {});
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      return run(() => {
        const id = path.split("/")[4]?.split("?")[0] ?? "";
        const doc = routes.detail?.(id);
        return doc ? { document: doc } : {};
      });
    }
    if (path.startsWith(LIST_BASE)) {
      return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: null }));
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser({
    id: "u1",
    email: "an@example.com",
    display_name: "An",
    onboarded_at: "2026-08-25T00:00:00Z",
    email_verified_at: "2026-08-25T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  });
});

describe("FD-07 W-A: folder URL, tree reveal, invalid folder state, and root (+) dialog", () => {
  it("opens 6 ancestors when a folder 7 levels deep is opened via URL, marks aria-current and scrolls it into view", async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const buildChain = (level: number): ReturnType<typeof folderNode> =>
      folderNode(`f${level}`, `Cấp ${level}`, level < 7 ? [buildChain(level + 1)] : []);

    const crumbs = Array.from({ length: 6 }, (_, i) => ({
      id: `f${i + 1}`,
      title: `Cấp ${i + 1}`,
    }));

    route({
      tree: () => [buildChain(1)],
      detail: (id) => (id === "f7" ? folderDetail("f7", "Cấp 7", { breadcrumbs: crumbs }) : null),
    });

    renderWithUrl(`/org/${WS}/documents?folder=f7`);

    const targetRow = await screen.findByRole("treeitem", { name: /Cấp 7/ });
    expect(targetRow).toHaveAttribute("aria-current", "true");

    for (let level = 1; level <= 6; level += 1) {
      const ancestorRow = screen.getByRole("treeitem", { name: new RegExp(`Cấp ${level}`) });
      expect(ancestorRow).toHaveAttribute("aria-expanded", "true");
    }

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    // Tree fetch passes folders_only=true
    expect(
      requestMock.mock.calls.some(([path]) => String(path).startsWith(TREE_URL) && String(path).includes("folders_only=true")),
    ).toBe(true);
  });

  it("keeps an ancestor collapsed across refetches after the user collapses it, while preserving previously opened branches", async () => {
    const branchA = folderNode("a1", "Nhánh A", [folderNode("a2", "Nhánh A con")]);
    const branchB = folderNode("f1", "Tổ tiên 1", [
      folderNode("f2", "Tổ tiên 2", [folderNode("f3", "Đích 3")]),
    ]);

    let detailFetches = 0;
    route({
      tree: () => [branchA, branchB],
      detail: (id) => {
        if (id === "f3") {
          detailFetches += 1;
          return folderDetail("f3", "Đích 3", {
            breadcrumbs: [
              { id: "f1", title: "Tổ tiên 1" },
              { id: "f2", title: "Tổ tiên 2" },
            ],
          });
        }
        return null;
      },
    });

    const { nav, queryClient } = renderWithUrl(`/org/${WS}/documents`);

    // Expand branch A manually before navigating to f3
    const expandA = await screen.findByRole("button", { name: t("documents.tree.expand", { title: "Nhánh A" }) });
    fireEvent.click(expandA);
    expect(await screen.findByRole("treeitem", { name: /Nhánh A con/ })).toBeInTheDocument();

    // Navigate to ?folder=f3
    act(() => {
      nav.push(`/org/${WS}/documents?folder=f3`);
    });

    // f3 is revealed and branch A stays open
    expect(await screen.findByRole("treeitem", { name: /Đích 3/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("treeitem", { name: /Nhánh A con/ })).toBeInTheDocument();

    // User collapses ancestor f2 after arrival
    const collapseF2 = screen.getByRole("button", { name: t("documents.tree.collapse", { title: "Tổ tiên 2" }) });
    fireEvent.click(collapseF2);
    expect(screen.queryByRole("treeitem", { name: /Đích 3/ })).toBeNull();
    expect(screen.getByRole("treeitem", { name: /Tổ tiên 2/ })).toHaveAttribute("aria-expanded", "false");

    // Refetch both detail and tree for the same ?folder=f3
    const prevFetches = detailFetches;
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(detailFetches).toBeGreaterThan(prevFetches);

    // f2 stays collapsed and branch A stays open
    expect(screen.getByRole("treeitem", { name: /Tổ tiên 2/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: /Đích 3/ })).toBeNull();
    expect(screen.getByRole("treeitem", { name: /Nhánh A con/ })).toBeInTheDocument();
  });

  it("opens the known breadcrumb part without error when an ancestor is restricted", async () => {
    const tree = folderNode("f1", "Gốc mở", [
      folderNode("f2", "Tổ tiên hạn chế", [folderNode("f3", "Thư mục con")]),
    ]);

    route({
      tree: () => [tree],
      // Server truncated breadcrumbs at the unreadable ancestor, leaving only f1
      detail: (id) =>
        id === "f3"
          ? folderDetail("f3", "Thư mục con", { breadcrumbs: [{ id: "f1", title: "Gốc mở" }] })
          : null,
    });

    renderWithUrl(`/org/${WS}/documents?folder=f3`);

    await waitFor(() =>
      expect(screen.getByRole("treeitem", { name: /Gốc mở/ })).toHaveAttribute("aria-expanded", "true"),
    );
    expect(screen.getByRole("treeitem", { name: /Tổ tiên hạn chế/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["unknown (404)", () => { throw new ApiError("not found", "not_found", 404); }],
    ["forbidden (403)", () => { throw new ApiError("forbidden", "forbidden", 403); }],
    ["archived", () => folderDetail("bad", "Đã xóa", { archived_at: "2026-10-10T00:00:00Z" })],
    ["not a folder", () => folderDetail("bad", "Một trang", { kind: "page" })],
    ["other workspace", () => folderDetail("bad", "Khác ws", { workspace_id: "ws-other" })],
  ])("renders the same error state with a link back to root when ?folder is %s", async (_label, detailHandler) => {
    route({
      tree: () => [],
      list: () => [],
      detail: () => detailHandler(),
    });

    const { nav } = renderWithUrl(`/org/${WS}/documents?folder=bad`);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(t("documents.home.folder_invalid.title"))).toBeInTheDocument();
    expect(within(alert).getByText(t("documents.home.folder_invalid.description"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.home.empty.folder_title"))).toBeNull();
    expect(screen.queryByText(t("documents.home.empty.title"))).toBeNull();

    const backLink = within(alert).getByRole("link", { name: t("documents.home.folder_invalid.back") });
    fireEvent.click(backLink);

    await waitFor(() => expect(nav.searchParams.get("folder")).toBeNull());
    expect(nav.pathname).toBe(`/org/${WS}/documents`);
  });

  it("updates the URL on tree click and returns to the previous folder on Back", async () => {
    route({
      tree: () => [folderNode("fo1", "Hợp đồng"), folderNode("fo2", "Tài chính")],
      list: () => [],
      detail: (id) =>
        id === "fo1"
          ? folderDetail("fo1", "Hợp đồng")
          : id === "fo2"
            ? folderDetail("fo2", "Tài chính")
            : null,
    });

    const { nav } = renderWithUrl(`/org/${WS}/documents`);

    const item1 = await screen.findByRole("treeitem", { name: /Hợp đồng/ });
    fireEvent.click(item1);

    await waitFor(() => expect(nav.searchParams.get("folder")).toBe("fo1"));
    expect(nav.push).toHaveBeenLastCalledWith(`/org/${WS}/documents?folder=fo1`);
    const crumbs1 = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs1).getByText("Hợp đồng")).toHaveAttribute("aria-current", "page");

    const item2 = screen.getByRole("treeitem", { name: /Tài chính/ });
    fireEvent.click(item2);

    await waitFor(() => expect(nav.searchParams.get("folder")).toBe("fo2"));
    expect(nav.push).toHaveBeenLastCalledWith(`/org/${WS}/documents?folder=fo2`);
    const crumbs2 = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs2).getByText("Tài chính")).toHaveAttribute("aria-current", "page");

    // Back returns to fo1
    act(() => {
      nav.back();
    });
    await waitFor(() => expect(nav.searchParams.get("folder")).toBe("fo1"));
    expect(screen.getByRole("treeitem", { name: /Hợp đồng/ })).toHaveAttribute("aria-current", "true");

    // Back again returns to root
    act(() => {
      nav.back();
    });
    await waitFor(() => expect(nav.searchParams.get("folder")).toBeNull());
    expect(screen.queryByRole("navigation", { name: t("documents.home.breadcrumb_label") })).toBeNull();
  });

  it("creates at root when (+) is clicked inside an open folder, and titles the dialog for root", async () => {
    let postedBody: unknown = null;
    route({
      tree: () => [folderNode("fo1", "Dự án CCB")],
      list: () => [],
      detail: (id) =>
        id === "fo1"
          ? folderDetail("fo1", "Dự án CCB")
          : id === "fo-root"
            ? folderDetail("fo-root", "Thư mục gốc mới")
            : null,
      post: (_path, body) => {
        postedBody = body;
        return { document: folderDetail("fo-root", "Thư mục gốc mới") };
      },
    });

    const { nav } = renderWithUrl(`/org/${WS}/documents?folder=fo1`);
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.folders.new") }));

    const dialog = await screen.findByRole("dialog", { name: t("documents.home.folders.create_title_root") });
    expect(within(dialog).getByText(t("documents.home.folders.create_title_root"))).toBeInTheDocument();

    const input = within(dialog).getByRole("textbox", { name: t("documents.home.folders.rename_label") });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.home.folders.name_empty"));
    expect(postedBody).toBeNull();

    fireEvent.change(input, { target: { value: "Thư mục gốc mới" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    await waitFor(() =>
      expect(postedBody).toEqual({
        kind: "folder",
        title: "Thư mục gốc mới",
      }),
    );
    await waitFor(() => expect(nav.searchParams.get("folder")).toBe("fo-root"));
  });
});
