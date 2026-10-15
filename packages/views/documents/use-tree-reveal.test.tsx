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
import { DocumentTree } from "./document-tree";
import { DocumentsPageView } from "./documents-page-view";
import { DocumentsSidebarSheet } from "./documents-sidebar";

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

function renderWithUrl(
  initialUrl = `/org/${WS}/documents`,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  }),
) {
  const nav = createTestNav(initialUrl);
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

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" }));
    expect(document.activeElement).toBe(document.body);
    expect(targetRow).toHaveAttribute("tabIndex", "0");
    expect(screen.getByRole("treeitem", { name: /Cấp 1/ })).toHaveAttribute("tabIndex", "-1");
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

  it("returns to the open folder when navigating folder -> Recent -> Back", async () => {
    route({
      tree: () => [folderNode("fo1", "Hợp đồng")],
      list: (path) =>
        path.startsWith(`${LIST_BASE}/recent`)
          ? [{ id: "r1", workspace_id: WS, kind: "page", title: "Tài liệu gần đây", revision: "1", updated_at: "2026-10-14T00:00:00Z" }]
          : [],
      detail: (id) => (id === "fo1" ? folderDetail("fo1", "Hợp đồng") : null),
    });

    const { nav } = renderWithUrl(`/org/${WS}/documents?folder=fo1`);

    const crumbs = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs).getByText("Hợp đồng")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("treeitem", { name: /Hợp đồng/ })).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) })[0]!);
    expect(await screen.findByRole("heading", { level: 2, name: t("documents.home.views.recent") })).toBeInTheDocument();
    expect(await screen.findByText("Tài liệu gần đây")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: t("documents.home.breadcrumb_label") })).toBeNull();

    act(() => {
      nav.back();
    });

    await waitFor(() => expect(nav.searchParams.get("folder")).toBe("fo1"));
    const restoredCrumbs = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(restoredCrumbs).getByText("Hợp đồng")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("treeitem", { name: /Hợp đồng/ })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("heading", { level: 2, name: t("documents.home.views.recent") })).toBeNull();
  });

  it("restores Recent when navigating Recent -> Starred -> Back", async () => {
    route({
      tree: () => [],
      list: (path) =>
        path.startsWith(`${LIST_BASE}/recent`)
          ? [{ id: "r1", workspace_id: WS, kind: "page", title: "Tài liệu gần đây", revision: "1", updated_at: "2026-10-14T00:00:00Z" }]
          : [],
    });

    const { nav } = renderWithUrl(`/org/${WS}/documents`);
    await screen.findByText(t("documents.home.empty.title"));

    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) })[0]!);
    expect(await screen.findByRole("heading", { level: 2, name: t("documents.home.views.recent") })).toBeInTheDocument();
    expect(await screen.findByText("Tài liệu gần đây")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("documents.home.sidebar.starred")) })[0]!);
    expect(await screen.findByRole("heading", { level: 2, name: t("documents.home.views.starred") })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: t("documents.home.views.recent") })).toBeNull();

    act(() => {
      nav.back();
    });

    expect(await screen.findByRole("heading", { level: 2, name: t("documents.home.views.recent") })).toBeInTheDocument();
    expect(await screen.findByText("Tài liệu gần đây")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: t("documents.home.views.starred") })).toBeNull();
  });

  it.each([
    ["forbidden (403)", 403, "forbidden"],
    ["unknown (404)", 404, "not_found"],
  ])("shows the invalid-folder error state on the first %s response without waiting for retries", async (_label, status, code) => {
    let detailCalls = 0;
    route({
      tree: () => [],
      list: () => [],
      detail: () => {
        detailCalls += 1;
        throw new ApiError(code, code, status);
      },
    });

    const queryClientWithRetries = new QueryClient({
      defaultOptions: {
        queries: { retry: 3, retryDelay: 10_000 },
        mutations: { retry: false },
      },
    });

    renderWithUrl(`/org/${WS}/documents?folder=bad`, queryClientWithRetries);

    const alert = await screen.findByRole("alert", undefined, { timeout: 500 });
    expect(within(alert).getByText(t("documents.home.folder_invalid.title"))).toBeInTheDocument();
    expect(detailCalls).toBe(1);
  });

  it("scrolls the current row into view once when a hidden tree becomes shown (visible false -> true) without stealing focus from an input outside the tree or re-opening collapsed ancestors (R4-1)", async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const buildChain = (level: number): ReturnType<typeof folderNode> =>
      folderNode(`f${level}`, `Cấp ${level}`, level < 4 ? [buildChain(level + 1)] : []);

    route({
      tree: () => [buildChain(1)],
      detail: (id) =>
        id === "f4"
          ? folderDetail("f4", "Cấp 4", {
              breadcrumbs: [
                { id: "f1", title: "Cấp 1" },
                { id: "f2", title: "Cấp 2" },
                { id: "f3", title: "Cấp 3" },
              ],
            })
          : null,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
    });

    const renderTreeHost = (visible: boolean) => (
      <QueryClientProvider client={queryClient}>
        <LocaleAdapterProvider adapter={localeAdapter}>
          <input type="text" aria-label="Search" data-testid="outside-input" />
          <div data-testid="tree-host">
            <DocumentTree wsId={WS} folders visible={visible} currentId="f4" />
          </div>
        </LocaleAdapterProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(renderTreeHost(false));
    const input = screen.getByTestId("outside-input");
    input.focus();
    expect(document.activeElement).toBe(input);

    const host = screen.getByTestId("tree-host");
    const hiddenTargetRow = await within(host).findByRole("treeitem", { name: /Cấp 4/ });
    expect(hiddenTargetRow).toHaveAttribute("aria-current", "true");
    // While visible=false, scrollIntoView must not have fired and consumed the reveal.
    expect(scrollSpy).not.toHaveBeenCalled();

    // Showing the tree (visible false -> true) triggers exactly one scrollIntoView and keeps focus in the outside input.
    rerender(renderTreeHost(true));

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    const targetRow = screen.getByRole("treeitem", { name: /Cấp 4/ });
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollSpy.mock.instances[0]).toBe(targetRow);
    expect(document.activeElement).toBe(input);

    // User collapses ancestor f3; hiding and re-showing the tree must not re-open f3.
    fireEvent.click(screen.getByRole("button", { name: t("documents.tree.collapse", { title: "Cấp 3" }) }));
    expect(screen.getByRole("treeitem", { name: /Cấp 3/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: /Cấp 4/ })).toBeNull();

    rerender(renderTreeHost(false));
    rerender(renderTreeHost(true));

    expect(screen.getByRole("treeitem", { name: /Cấp 3/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: /Cấp 4/ })).toBeNull();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it("observes the nav/tree container via ResizeObserver when visible=true but hidden by computed style, without attaching any observer to document.body (R3-2, R3-3)", async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const mutationTargets: Node[] = [];
    const mutationSpy = vi
      .spyOn(MutationObserver.prototype, "observe")
      .mockImplementation(function (this: MutationObserver, target: Node) {
        mutationTargets.push(target);
      });

    const resizeTargets: Element[] = [];
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
          resizeCallbacks.push(cb);
        }
        observe(target: Element) {
          resizeTargets.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );

    try {
      route({
        tree: () => [folderNode("f1", "Cấp 1", [folderNode("f2", "Cấp 2")])],
        detail: (id) =>
          id === "f2"
            ? folderDetail("f2", "Cấp 2", { breadcrumbs: [{ id: "f1", title: "Cấp 1" }] })
            : null,
      });

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <LocaleAdapterProvider adapter={localeAdapter}>
            <nav data-testid="tree-nav" style={{ display: "none" }}>
              <DocumentTree wsId={WS} folders visible currentId="f2" />
            </nav>
          </LocaleAdapterProvider>
        </QueryClientProvider>,
      );

      const nav = screen.getByTestId("tree-nav");
      const targetRow = await within(nav).findByRole("treeitem", { name: /Cấp 2/, hidden: true });
      expect(targetRow).toHaveAttribute("aria-current", "true");
      expect(scrollSpy).not.toHaveBeenCalled();

      // No observer is attached to document.body; ResizeObserver targets the nav container.
      expect(mutationTargets).not.toContain(document.body);
      expect(resizeTargets).not.toContain(document.body);
      expect(resizeTargets).toContain(nav);

      // Laying out the container (computed style display: block) + ResizeObserver callback reveals the row once.
      nav.style.display = "block";
      act(() => {
        for (const cb of resizeCallbacks) {
          cb([], {} as ResizeObserver);
        }
      });

      await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
      expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
      expect(scrollSpy.mock.instances[0]).toBe(targetRow);
    } finally {
      mutationSpy.mockRestore();
      vi.stubGlobal("ResizeObserver", OriginalResizeObserver);
    }
  });

  it("resets sequential focus on document.body without moving focus to the row when a CSS-hidden tree is revealed with body active, and moves focus only when focus is already inside the tree (F3, V-F6)", async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const resizeCallbacks: ResizeObserverCallback[] = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          resizeCallbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const bodyFocusSpy = vi.spyOn(document.body, "focus");
    const bodyBlurSpy = vi.spyOn(document.body, "blur");

    try {
      route({
        tree: () => [folderNode("f1", "Cấp 1", [folderNode("f2", "Cấp 2")])],
        detail: (id) =>
          id === "f2"
            ? folderDetail("f2", "Cấp 2", { breadcrumbs: [{ id: "f1", title: "Cấp 1" }] })
            : id === "f1"
              ? folderDetail("f1", "Cấp 1")
              : null,
      });

      const renderNav = () => (
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
            })
          }
        >
          <LocaleAdapterProvider adapter={localeAdapter}>
            <nav data-testid="tree-nav" style={{ display: "none" }}>
              <DocumentTree wsId={WS} folders visible currentId="f2" />
            </nav>
          </LocaleAdapterProvider>
        </QueryClientProvider>
      );

      const firstMount = render(renderNav());

      const nav = screen.getByTestId("tree-nav");
      const targetRow = await within(nav).findByRole("treeitem", { name: /Cấp 2/, hidden: true });
      expect(targetRow).toHaveAttribute("aria-current", "true");
      expect(document.activeElement).toBe(document.body);
      expect(scrollSpy).not.toHaveBeenCalled();

      bodyFocusSpy.mockClear();
      bodyBlurSpy.mockClear();

      // 1. Deferred reveal while focus is on document.body: must NOT focus the row, must run V-F6 body reset.
      nav.style.display = "block";
      act(() => {
        for (const cb of resizeCallbacks) {
          cb([], {} as ResizeObserver);
        }
      });

      await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
      expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
      expect(scrollSpy.mock.instances[0]).toBe(targetRow);
      expect(document.activeElement).toBe(document.body);
      expect(bodyFocusSpy).toHaveBeenCalledWith({ preventScroll: true });
      expect(bodyBlurSpy).toHaveBeenCalledTimes(1);
      expect(document.body.getAttribute("tabindex")).toBeNull();
      firstMount.unmount();

      // 2. Deferred reveal while focus is already inside the tree: moves focus onto the revealed target row.
      resizeCallbacks.length = 0;
      render(renderNav());
      const nav2 = screen.getByTestId("tree-nav");
      const targetRow2 = await within(nav2).findByRole("treeitem", { name: /Cấp 2/, hidden: true });
      const row1 = within(nav2).getByRole("treeitem", { name: /Cấp 1/, hidden: true });
      row1.focus();
      expect(document.activeElement).toBe(row1);

      nav2.style.display = "block";
      act(() => {
        for (const cb of resizeCallbacks) {
          cb([], {} as ResizeObserver);
        }
      });
      await waitFor(() => expect(document.activeElement).toBe(targetRow2));
    } finally {
      bodyFocusSpy.mockRestore();
      bodyBlurSpy.mockRestore();
      vi.stubGlobal("ResizeObserver", OriginalResizeObserver);
    }
  });

  it("moves focus into the phone sheet onto the current row, scrolls it into view once without re-opening collapsed ancestors, and returns focus to the trigger on Escape", async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const buildChain = (level: number): ReturnType<typeof folderNode> =>
      folderNode(`f${level}`, `Cấp ${level}`, level < 4 ? [buildChain(level + 1)] : []);

    route({
      tree: () => [buildChain(1)],
      detail: (id) =>
        id === "f4"
          ? folderDetail("f4", "Cấp 4", {
              breadcrumbs: [
                { id: "f1", title: "Cấp 1" },
                { id: "f2", title: "Cấp 2" },
                { id: "f3", title: "Cấp 3" },
              ],
            })
          : null,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
    });
    const onOpenChange = vi.fn();

    const renderSheet = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <LocaleAdapterProvider adapter={localeAdapter}>
          <button type="button" data-testid="sheet-trigger">
            {t("documents.home.sidebar.open")}
          </button>
          <DocumentsSidebarSheet
            open={open}
            onOpenChange={onOpenChange}
            wsId={WS}
            view={{ kind: "home" }}
            folderId="f4"
            starredCount={null}
            sourcesAvailable={false}
            canCreate
            onView={vi.fn()}
            onFolder={vi.fn()}
            onNewFolder={vi.fn()}
          />
        </LocaleAdapterProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(renderSheet(false));
    const trigger = screen.getByTestId("sheet-trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    expect(scrollSpy).not.toHaveBeenCalled();

    // Opening the sheet moves focus inside the sheet onto the current row and scrolls it into view once.
    rerender(renderSheet(true));

    const dialog = await screen.findByRole("dialog");
    const targetRow = await within(dialog).findByRole("treeitem", { name: /Cấp 4/ });
    expect(targetRow).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollSpy.mock.instances[0]).toBe(targetRow);
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    expect(document.activeElement).toBe(targetRow);

    // Collapsing an ancestor inside the open sheet keeps it collapsed across refetches.
    fireEvent.click(screen.getByRole("button", { name: t("documents.tree.collapse", { title: "Cấp 3" }) }));
    expect(screen.getByRole("treeitem", { name: /Cấp 3/ })).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(screen.getByRole("treeitem", { name: /Cấp 3/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: /Cấp 4/ })).toBeNull();
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // Pressing Escape closes the sheet and returns focus to the trigger.
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    rerender(renderSheet(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
