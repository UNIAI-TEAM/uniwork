import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { defaultStorage } from "@uniwork/core/platform";
import { fakeNav, requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { pickTypeFilter, typeFilterSelect } from "../test/type-filter";
import type { OfficeLaunchSessionFactory } from "../office";
import { WorkspaceProvider } from "../layout/workspace-context";
import { DocumentsPageView } from "./documents-page-view";
import { useDocumentsLibrary } from "./use-documents-library";

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const LEGACY_FOLDER_SORT_KEY = "uniwork_documents_folder_sort";
const legacyFolderSortKey = (userId: string) => `${LEGACY_FOLDER_SORT_KEY}:${userId}`;
const SORT_KEY = "uniwork_documents_sort";
const userSortKey = (userId: string) => `${SORT_KEY}:${userId}`;
const lastCreateKey = (wsId: string) => `uniwork:documents:last-create-type:${wsId}`;
const storedSort = (userId: string) => {
  const raw = defaultStorage.getItem(userSortKey(userId));
  return raw ? (JSON.parse(raw) as unknown) : null;
};

const sessionUser = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

/** The screen is gated by `documents`; the flag has to be on to see anything. */
function withFlag(ui: React.ReactElement, on: boolean, nav = fakeNav()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={sessionUser}>
      <FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>
    </WorkspaceProvider>,
    nav,
  );
}

function summary(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "1",
    my_level: "manage",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

function treeNode(over: Record<string, unknown> = {}) {
  return { id: "t1", title: "Nhóm", kind: "page", position: 0, children: [], ...over };
}

function renderView(
  onOpen: (id: string) => void,
  opts:
    | boolean
    | {
        desktopOpen?: React.ComponentProps<typeof DocumentsPageView>["desktopOpen"];
        officeHome?: React.ComponentProps<typeof DocumentsPageView>["officeHome"];
        initialUrl?: string;
      } = true,
) {
  const on = typeof opts === "boolean" ? opts : true;
  const desktopOpen = typeof opts === "boolean" ? undefined : opts.desktopOpen;
  const officeHome = typeof opts === "boolean" ? undefined : opts.officeHome;
  const initialUrl = typeof opts === "boolean" ? undefined : opts.initialUrl;
  const nav = fakeNav(initialUrl);
  return {
    ...render(withFlag(<DocumentsPageView wsId={WS} onOpen={onOpen} desktopOpen={desktopOpen} officeHome={officeHome} />, on, nav)),
    nav,
  };
}

function queryOf(path: string) {
  return new URLSearchParams(path.split("?")[1] ?? "");
}

/** The column header cell, whatever the width rung says (jsdom evaluates no container query). */
function headerOf(column: "name" | "editor" | "updated" | "size" | "access") {
  return screen.getByRole("columnheader", { name: new RegExp(`^${escape(t(`documents.home.columns.${column}`))}`) });
}

/** Clicks a column's sort button (UNI-2038): the header is the only sort control. */
async function clickSort(column: "name" | "editor" | "updated" | "size") {
  const label = t("documents.home.columns." + column);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${escape(t("documents.home.sort.column", { column: label }))}`) }));
}

/** The folder view's old "Sắp xếp theo" Select is gone: no combobox carries a sort name. */
function noSortSelect() {
  return screen.queryByRole("combobox", { name: /^Sắp xếp|^Sort/ }) === null;
}

function postCall(method: string) {
  return requestMock.mock.calls.find(
    ([, opts]) => (opts as { method?: string } | undefined)?.method === method,
  );
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  for (const user of ["u1", "u2"]) {
    defaultStorage.removeItem(legacyFolderSortKey(user));
    defaultStorage.removeItem(userSortKey(user));
  }
  for (const ws of [WS, "ws2"]) defaultStorage.removeItem(lastCreateKey(ws));
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

describe("DocumentsPageView", () => {
  const otherCalls = () => requestMock.mock.calls.filter(([path]) => !String(path).startsWith("/api/v1/config"));

  it("stays behind its flag once the config answered that it is off", async () => {
    requestMock.mockResolvedValue({ flags: { documents: false }, rum_sample_rate: 0 });
    const onOpen = vi.fn();
    renderView(onOpen, false);
    expect(await screen.findByText(t("documents.page.off_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.page.unknown_title"))).toBeNull();
    expect(otherCalls()).toHaveLength(0);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("says it could not check, not that documents are off, when the config call fails", async () => {
    let configCalls = 0;
    requestMock.mockImplementation((path: string) => {
      if (!path.startsWith("/api/v1/config")) return Promise.resolve({});
      configCalls += 1;
      return configCalls === 1
        ? Promise.reject(new ApiError("boom", "internal", 500))
        : Promise.resolve({ flags: { documents: false }, rum_sample_rate: 0 });
    });
    renderView(vi.fn(), false);

    expect(await screen.findByText(t("documents.page.unknown_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.page.off_title"))).toBeNull();
    expect(otherCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: t("documents.page.unknown_retry") }));
    // A settled answer is the only thing that may claim the feature is off.
    expect(await screen.findByText(t("documents.page.off_title"))).toBeInTheDocument();
  });

  it("shows a neutral checking state while the config has not answered", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderView(vi.fn(), false);
    expect(screen.getByText(t("documents.page.checking_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.page.off_title"))).toBeNull();
  });


  it("translates its home copy instead of falling back to keys", () => {
    // A missing key renders as the key itself and the screen would read
    // "documents.home.scope.home" in production.
    for (const key of [
      "documents.home.sidebar.home",
      "documents.home.empty.title",
      "documents.home.quick_create.label",
      "documents.home.default_names.docx",
      "documents.home.create.upload.button",
      "documents.home.folders.empty",
      "office.desktop.row_action",
    ]) {
      expect(t(key)).not.toBe(key);
    }
  });

  it("lists the rows the server returned and counts them on the documents section, with no module header", async () => {
    route({ list: () => [summary(), summary({ id: "d2", title: "Biên bản họp" })] });
    renderView(vi.fn());

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.getByText("Biên bản họp")).toBeInTheDocument();
    // The section heading shows the loaded row count from the server, not a made-up one.
    expect(
      screen.getByRole("heading", { level: 2, name: new RegExp(`^${t("documents.home.sections.documents")}`) }),
    ).toHaveTextContent(/2$/);
    // The home root has no module header and no scope tabs.
    expect(screen.queryByRole("heading", { level: 1, name: t("documents.page.title") })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows skeleton rows while the first page loads, never fake rows", () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith(TREE_URL) ? Promise.resolve({ documents: [] }) : new Promise(() => {}),
    );
    renderView(vi.fn());

    expect(screen.getByLabelText(t("documents.library.loading"))).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();
  });

  it("shows the empty state with the Tạo nhanh pills when the library is truly empty", async () => {
    route({ list: () => [] });
    renderView(vi.fn());

    expect(await screen.findByText(t("documents.home.empty.title"))).toBeInTheDocument();
    const strip = screen.getByRole("region", { name: t("documents.home.quick_create.label") });
    for (const type of ["page", "docx", "xlsx", "pptx"]) {
      expect(within(strip).getByRole("button", { name: new RegExp(escape(t(`documents.home.create.${type}.chip`))) })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: t("documents.home.create.upload.button") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeInTheDocument();
  });

  it("offers a retry when the list cannot be read", async () => {
    let listCalls = 0;
    route({
      list: () => {
        listCalls += 1;
        if (listCalls === 1) throw new ApiError("boom", "internal", 500);
        return [summary()];
      },
    });
    renderView(vi.fn());

    expect(await screen.findByText(t("documents.library.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.retry") }));

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("loads another cursor page only when load more is clicked", async () => {
    const urls: string[] = [];
    route({
      list: (path) => {
        urls.push(path);
        return queryOf(path).get("cursor") === "c2" ? [summary({ id: "d2", title: "Trang hai" })] : [summary()];
      },
      cursor: (path) => (queryOf(path).get("cursor") === "c2" ? null : "c2"),
    });
    renderView(vi.fn());

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.queryByText("Trang hai")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));

    expect(await screen.findByText("Trang hai")).toBeInTheDocument();
    expect(urls.some((url) => queryOf(url).get("cursor") === "c2")).toBe(true);
  });

  it("filters by one picked type on the server: ?type= for file types and for UniNote (type=page)", async () => {
    const urls: string[] = [];
    route({
      list: (path) => {
        urls.push(path);
        const format = queryOf(path).get("type");
        if (format === "docx") return [file("f1", "Báo giá.docx")];
        if (format === "page") return [summary()];
        if (format) return [];
        return [summary(), file("f1", "Báo giá.docx"), file("f2", "Số liệu.xlsx")];
      },
    });
    renderView(vi.fn());
    expect(await screen.findByText("Số liệu.xlsx")).toBeInTheDocument();

    await pickTypeFilter("docx");
    await waitFor(() => expect(urls.some((url) => queryOf(url).get("type") === "docx")).toBe(true));
    expect(await screen.findByText("Báo giá.docx")).toBeInTheDocument();
    expect(screen.queryByText("Số liệu.xlsx")).toBeNull();
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();

    // The menu is multi-select: toggle .docx off and UniNote on.
    await pickTypeFilter("docx", "page");
    await waitFor(() => expect(urls.some((url) => queryOf(url).get("type") === "page")).toBe(true));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
  });

  it("sets the same state through the Loại menu as the chips did: the server query changes, the URL does not (UNI-2113)", async () => {
    const urls: string[] = [];
    route({ list: (path) => (urls.push(path), queryOf(path).get("type") === "xlsx" ? [file("f2", "Số liệu.xlsx")] : [summary(), file("f2", "Số liệu.xlsx")]) });
    const { nav } = renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");
    const search = nav.searchParams.toString();

    await pickTypeFilter("xlsx");
    await waitFor(() => expect(urls.some((url) => queryOf(url).get("type") === "xlsx")).toBe(true));
    await waitFor(() => expect(screen.queryByText("Kế hoạch Q4")).toBeNull());
    expect(typeFilterSelect()).toHaveTextContent(`${t("documents.home.filters.type")}: .xlsx`);
    // The type is page state, never a query parameter: no push, no replace, the same search string.
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.searchParams.toString()).toBe(search);

    await pickTypeFilter("all");
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(typeFilterSelect()).toHaveTextContent(`${t("documents.home.filters.type")}: ${t("documents.home.chips.all")}`);
  });

  it("shows the filtered empty state when a chip matches nothing, and clears it", async () => {
    route({ list: (path) => (queryOf(path).get("type") === "pdf" ? [] : [summary()]) });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");

    await pickTypeFilter("pdf");
    expect(await screen.findByText(t("documents.library.no_matches_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.clear_filters") }));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("keeps the home table flat and Recent flat while no row carries a last activity (W11 needs SV-1)", async () => {
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: () => [summary(), summary({ id: "fo1", kind: "folder", title: "Dự án CCB" }), file("f1", "Báo giá.docx", { parent_id: "fo1" })],
    });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");
    const groupHeaders = () => Array.from(document.querySelectorAll("[data-library-group]")).map((cell) => cell.textContent);
    expect(groupHeaders()).toEqual([]);
    await openView("recent");
    await screen.findByText("Báo giá.docx");
    expect(groupHeaders()).toEqual([]);
    // Q6: no Group by select and no access filter on the Recent toolbar.
    expect(screen.queryByText("Nhóm theo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Tôi quản lý" })).toBeNull();
  });

  it("explains the archive permission instead of rendering an empty archive", async () => {
    route({
      list: (path) => {
        if (queryOf(path).get("archived") === "1") throw new ApiError("forbidden", "forbidden", 403);
        return [summary()];
      },
    });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");

    await openView("trash");

    expect(await screen.findByText(t("documents.library.permission_title"))).toBeInTheDocument();
  });

  it("loads the recent and shared views from their own endpoints", async () => {
    route({
      list: (path) => {
        if (path.startsWith(`${LIST_BASE}/recent`)) return [summary({ id: "r1", title: "Mở gần đây" })];
        if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return [summary({ id: "s1", title: "Được chia sẻ" })];
        return [];
      },
    });
    renderView(vi.fn());
    await screen.findByText(t("documents.home.empty.title"));

    await openView("recent");
    expect(await screen.findByText("Mở gần đây")).toBeInTheDocument();

    await openView("shared");
    expect(await screen.findByText("Được chia sẻ")).toBeInTheDocument();
  });

  describe("Shared by me view (?view=shared-by-me, UNI-1851)", () => {
    it("navigates to ?view=shared-by-me from the sidebar, requests shared_by_me=true without parent_id even from a folder, and renders the heading and rows", async () => {
      const urls: string[] = [];
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) => {
          urls.push(path);
          const q = queryOf(path);
          if (q.get("shared_by_me") === "true") {
            return [summary({ id: "sbm1", title: "Đề xuất ngân sách Q4.docx", kind: "file", via: "owner", visibility: "restricted" })];
          }
          return [];
        },
      });
      const { nav } = renderView(vi.fn(), { initialUrl: `/acme/doi/documents?folder=fo1` });
      await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

      await openView("shared_by_me");
      expect(nav.push).toHaveBeenCalledWith("/acme/doi/documents?view=shared-by-me");
      expect(await screen.findByRole("heading", { level: 1, name: t("documents.home.views.shared_by_me") })).toBeInTheDocument();
      expect(await screen.findByText("Đề xuất ngân sách Q4.docx")).toBeInTheDocument();

      const sbmCalls = urls.filter((u) => queryOf(u).get("shared_by_me") === "true");
      expect(sbmCalls.length).toBeGreaterThan(0);
      for (const u of sbmCalls) {
        expect(queryOf(u).has("parent_id")).toBe(false);
      }
    });

    it("parses ?view=shared-by-me on initial load and shows the Shared by me empty state when the list is empty", async () => {
      route({ list: () => [] });
      renderView(vi.fn(), { initialUrl: `/acme/doi/documents?view=shared-by-me` });

      expect(await screen.findByRole("heading", { level: 1, name: t("documents.home.views.shared_by_me") })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: t("documents.home.sidebar.shared_by_me") })[0]).toHaveAttribute("aria-current", "page");
      expect(await screen.findByText(t("documents.home.empty.shared_by_me_title"))).toBeInTheDocument();
      expect(screen.getByText(t("documents.home.empty.shared_by_me_description"))).toBeInTheDocument();
    });

    it("shows the plain home-workspace scope badge on the narrow line of a shared-by-me row (SW-V2)", async () => {
      const homeScope = { users: 0, home_workspace: true, workspaces: 0, organization: false, public_link: false };
      route({
        list: (path) =>
          queryOf(path).get("shared_by_me") === "true"
            ? [summary({ id: "sbm4", title: "Đề xuất ngân sách Q4.docx", via: "owner", visibility: "workspace", share_scope: homeScope })]
            : [],
      });
      renderView(vi.fn(), { initialUrl: `/acme/doi/documents?view=shared-by-me` });
      const row = await rowOf("Đề xuất ngân sách Q4.docx");
      const line = row.querySelector("[data-library-access-line]") as HTMLElement;
      expect(within(line).getByTestId("document-share-scope-badge")).toBeInTheDocument();
    });

    it("offers Rename, Move and Archive on a shared-by-me row the caller manages", async () => {
      route({
        list: (path) =>
          queryOf(path).get("shared_by_me") === "true"
            ? [summary({ id: "sbm3", title: "Đề xuất ngân sách Q4.docx", my_level: "manage", via: "owner", visibility: "restricted" })]
            : [],
      });
      renderView(vi.fn(), { initialUrl: `/acme/doi/documents?view=shared-by-me` });
      const row = await rowOf("Đề xuất ngân sách Q4.docx");
      fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách Q4.docx" }) }));
      await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") });
      expect(screen.getByRole("menuitem", { name: t("documents.home.row.rename") })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: t("documents.home.row.move") })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: t("documents.home.row.archive") })).toBeInTheDocument();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeNull());
    });

    it("degrades a malformed shared_by_me response to the retryable error state without crashing", async () => {
      let calls = 0;
      requestMock.mockImplementation((path: string) => {
        if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
        if (path.startsWith(`${LIST_BASE}/sources`)) return Promise.resolve({ items: [], next_cursor: null });
        if (path.startsWith(LIST_BASE) && queryOf(path).get("shared_by_me") === "true") {
          calls += 1;
          return calls === 1
            ? Promise.resolve({ documents: "not-an-array" })
            : Promise.resolve({ documents: [summary({ id: "sbm2", title: "Tài liệu đã chia sẻ" })], next_cursor: null });
        }
        return Promise.resolve({ documents: [], next_cursor: null });
      });
      renderView(vi.fn(), { initialUrl: `/acme/doi/documents?view=shared-by-me` });

      expect(await screen.findByText(t("documents.library.error_title"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t("documents.library.retry") }));
      expect(await screen.findByText("Tài liệu đã chia sẻ")).toBeInTheDocument();
    });
  });

  it("navigates into a folder from its card, lists its children and renames it on the breadcrumb", async () => {
    const urls: string[] = [];
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: (path) => {
        urls.push(path);
        if (queryOf(path).get("parent_id") === "fo1") return [file("f1", "Bên trong.docx", { parent_id: "fo1" })];
        return [summary({ id: "fo1", kind: "folder", title: "Dự án CCB" })];
      },
      detail: (id) => (id === "fo1" ? folderDetail({ my_level: "manage" }) : null),
      patch: () => ({ document: folderDetail({ title: "CCB 2027", revision: "4" }) }),
    });
    const onOpen = vi.fn();
    renderView(onOpen);

    const section = await screen.findByRole("region", { name: sectionName("folders") });
    fireEvent.click(await within(section).findByRole("button", { name: /^Dự án CCB/ }));

    expect(await screen.findByText("Bên trong.docx")).toBeInTheDocument();
    expect(urls.some((url) => queryOf(url).get("parent_id") === "fo1")).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    const crumbs = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs).getByText("Dự án CCB")).toHaveAttribute("aria-current", "page");
    // The folder is drawn as current in the sidebar tree too.
    expect(screen.getByRole("treeitem", { name: /Dự án CCB/ })).toHaveAttribute("aria-current", "true");

    fireEvent.click(within(crumbs).getByRole("button", { name: t("documents.home.folders.rename") }));
    const input = within(crumbs).getByRole("textbox", { name: t("documents.home.folders.rename_label") });
    fireEvent.change(input, { target: { value: "CCB 2027" } });
    fireEvent.submit(input);
    await waitFor(() => {
      const patch = requestMock.mock.calls.find(([, opts]) => (opts as { method?: string } | undefined)?.method === "PATCH");
      expect(patch?.[0]).toBe("/api/v1/documents/fo1");
      expect((patch?.[1] as { body?: unknown }).body).toEqual({ revision: "3", title: "CCB 2027" });
    });
  });

  it("opens a folder from the sidebar tree, which lists folders only", async () => {
    route({
      tree: () => [
        treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" }),
        treeNode({ id: "p1", title: "Một trang", kind: "page" }),
      ],
      list: () => [],
      detail: () => folderDetail(),
    });
    const onOpen = vi.fn();
    renderView(onOpen);

    const folderItem = await screen.findByRole("treeitem", { name: /Dự án CCB/ });
    expect(screen.queryByRole("treeitem", { name: /Một trang/ })).toBeNull();
    fireEvent.click(folderItem);
    expect(await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("creates a page from its Tạo nhanh pill and opens it", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], post: () => ({ document: summary() }) });
    renderView(onOpen);

    fireEvent.click(await pillButton("page"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d1"));
    const call = postCall("POST");
    expect(call?.[0]).toBe(LIST_BASE);
    expect((call?.[1] as { body?: { title?: string } }).body?.title).toBe(t("documents.page.new_page"));
  });

  it("keeps the Tạo nhanh strip to UniNote, DOCX, XLSX and PPTX, with no txt pill", async () => {
    route({ list: () => [] });
    renderView(vi.fn());

    const strip = await screen.findByRole("region", { name: t("documents.home.quick_create.label") });
    const names = within(strip).getAllByRole("button").map((b) => (b.textContent ?? "").trim());
    expect(names).toEqual(
      ["page", "docx", "xlsx", "pptx"].map((type) => t(`documents.home.create.${type}.chip`)),
    );
    expect(within(strip).queryByTitle(".txt")).toBeNull();
  });

  describe("the last-created pill", () => {
    const stripNames = async () => {
      const strip = await screen.findByRole("region", { name: t("documents.home.quick_create.label") });
      return within(strip).getAllByRole("button").map((b) => (b.textContent ?? "").trim());
    };
    const chips = (...types: string[]) => types.map((type) => t(`documents.home.create.${type}.chip`));

    it("shows a pill for a Markdown file after creating one from the New menu, and keeps it for next time", async () => {
      const onOpen = vi.fn();
      route({ list: () => [], post: () => ({ document: file("n3", t("documents.home.default_names.md")) }) });
      const first = renderView(onOpen);
      expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx"));

      fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
      fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.md.menu")) }));

      await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n3"));
      await waitFor(async () => expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx", "md")));
      expect(defaultStorage.getItem(lastCreateKey(WS))).toBe("md");

      // a fresh mount (a reload) still has it
      first.unmount();
      renderView(vi.fn());
      expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx", "md"));
    });

    it("creates from the extra pill like from any other", async () => {
      defaultStorage.setItem(lastCreateKey(WS), "pdf");
      const onOpen = vi.fn();
      route({ list: () => [], post: () => ({ document: file("n4", t("documents.home.default_names.pdf")) }) });
      renderView(onOpen);

      fireEvent.click(await pillButton("pdf"));

      await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n4"));
      expect((postCall("POST")?.[1] as { body?: { format?: string } }).body?.format).toBe("pdf");
    });

    it("adds no pill when the last type is one of the four, whatever created it", async () => {
      const onOpen = vi.fn();
      route({ list: () => [], post: () => ({ document: file("n5", t("documents.home.default_names.docx")) }) });
      renderView(onOpen);

      fireEvent.click(await pillButton("docx"));

      await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n5"));
      expect(defaultStorage.getItem(lastCreateKey(WS))).toBe("docx");
      expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx"));
    });

    it("drops the extra pill once a strip type is created after it", async () => {
      defaultStorage.setItem(lastCreateKey(WS), "html");
      route({ list: () => [], post: () => ({ document: summary() }) });
      renderView(vi.fn());
      expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx", "html"));

      fireEvent.click(await pillButton("page"));

      await waitFor(async () => expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx")));
    });

    it("is per workspace: another workspace's last type does not show here", async () => {
      defaultStorage.setItem(lastCreateKey("ws2"), "pdf");
      route({ list: () => [] });
      renderView(vi.fn());
      expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx"));
    });

    it("ignores a stored value that is not a create type, and never offers Plain text as a pill", async () => {
      for (const stored of ["bogus", "txt", ""]) {
        defaultStorage.setItem(lastCreateKey(WS), stored);
        route({ list: () => [] });
        const view = renderView(vi.fn());
        expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx"));
        view.unmount();
      }
    });

    it("keeps working when storage cannot be read or written", async () => {
      const getSpy = vi.spyOn(defaultStorage, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const setSpy = vi.spyOn(defaultStorage, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      try {
        const onOpen = vi.fn();
        route({ list: () => [], post: () => ({ document: file("n6", t("documents.home.default_names.md")) }) });
        renderView(onOpen);
        fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
        fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.md.menu")) }));
        await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n6"));
        expect(await stripNames()).toEqual(chips("page", "docx", "xlsx", "pptx", "md"));
      } finally {
        getSpy.mockRestore();
        setSpy.mockRestore();
      }
    });
  });

  it("creates a blank file with its default name from a pill, then opens the editor", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], post: () => ({ document: file("n1", t("documents.home.default_names.docx")) }) });
    renderView(onOpen);

    fireEvent.click(await pillButton("docx"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n1"));
    const call = postCall("POST");
    expect(call?.[0]).toBe(`${LIST_BASE}/files/blank`);
    expect((call?.[1] as { body?: unknown }).body).toEqual({
      format: "docx",
      title: t("documents.home.default_names.docx"),
      destination: "my_folder",
    });
  });

  it("creates from the header menu in the open folder", async () => {
    const onOpen = vi.fn();
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: () => [],
      detail: () => folderDetail({ my_level: "edit" }),
      post: () => ({ document: file("n2", t("documents.home.default_names.xlsx")) }),
    });
    renderView(onOpen);
    fireEvent.click(await screen.findByRole("treeitem", { name: /Dự án CCB/ }));
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.xlsx.menu")) }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n2"));
    expect((postCall("POST")?.[1] as { body?: unknown }).body).toEqual({
      format: "xlsx",
      title: t("documents.home.default_names.xlsx"),
      parent_id: "fo1",
    });
  });

  it("disables a pill the server cannot create yet instead of failing the page", async () => {
    route({
      list: () => [],
      post: () => {
        throw new ApiError("not found", "not_found", 404);
      },
    });
    renderView(vi.fn());

    const pptx = await pillButton("pptx");
    fireEvent.click(pptx);

    await waitFor(() => expect(pptx).toHaveAttribute("aria-disabled", "true"));
    expect(pptx).toHaveTextContent(t("documents.home.create.unavailable_hint"));
  });

  it("hides every create control in a folder the user may only view", async () => {
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: () => [],
      detail: () => folderDetail({ my_level: "view" }),
    });
    renderView(vi.fn());
    fireEvent.click(await screen.findByRole("treeitem", { name: /Dự án CCB/ }));

    expect(await screen.findByText(t("documents.home.empty.view_only"))).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: t("documents.home.quick_create.label") })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.home.folders.new") })).toBeNull();
    const crumbs = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs).queryByRole("button", { name: t("documents.home.folders.rename") })).toBeNull();
  });

  it("creates a folder with its default name and opens it", async () => {
    route({
      list: () => [],
      post: () => ({ document: folderDetail({ id: "fo9", title: t("documents.home.folders.default_name") }) }),
      detail: () => folderDetail({ id: "fo9", title: t("documents.home.folders.default_name") }),
    });
    renderView(vi.fn());

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.folders.new") }));
    const dialog = await screen.findByRole("dialog", { name: t("documents.home.folders.create_title_root") });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    // Create, close, open and fetch the folder chain past the 1s default under the full CI run.
    const crumbs = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") }, { timeout: 5000 });
    expect(within(crumbs).getByText(t("documents.home.folders.default_name"))).toBeInTheDocument();
    expect((postCall("POST")?.[1] as { body?: unknown }).body).toEqual({
      kind: "folder",
      title: t("documents.home.folders.default_name"),
    });
  });

  it("lists files from other modules as links: download and save, no app action", async () => {
    route({
      list: () => [summary()],
      sources: () => [source()],
      post: () => ({ document: file("c1", "Đề xuất ngân sách.pdf") }),
    });
    const createSession = vi.fn<OfficeLaunchSessionFactory>();
    renderView(vi.fn(), { desktopOpen: desktopOpenWith(createSession) });

    const row = await rowOf("Đề xuất ngân sách.pdf");
    // The board has no Source column; the owner name rides the secondary line until its column joins.
    expect(within(row).getAllByText("Dũng").length).toBeGreaterThan(0);
    expect(within(row).queryByRole("button", { name: t("office.desktop.row_action") })).toBeNull();
    expect(within(row).getByRole("button", { name: t("documents.home.row.go_to_source_named", { title: "Đề xuất ngân sách.pdf" }) })).toBeInTheDocument();
    // The sidebar names the modules once the sources API answered.
    expect(screen.getByRole("button", { name: t("documents.home.origin.chat") })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách.pdf" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.save_to_folder") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));

    await waitFor(() => {
      const call = postCall("POST");
      expect(call?.[0]).toBe(`${LIST_BASE}/sources/chat%3Am1/save`);
      expect((call?.[1] as { body?: unknown }).body).toEqual({ parent_id: null });
      // A retried POST after a timeout must replay, not save the file twice.
      expect((call?.[1] as { headers?: Record<string, string> }).headers?.["Idempotency-Key"]).toBeTruthy();
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("hides the other-modules section when the sources API is not deployed", async () => {
    route({ list: () => [summary()], sources: () => { throw new ApiError("not found", "not_found", 404); } });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");
    await waitFor(() => expect(sourceCalls()).toBeGreaterThan(0));
    expect(screen.queryByText(t("documents.home.sidebar.elsewhere"))).toBeNull();
    // Not retried: a missing route is an answer, not a failure.
    expect(sourceCalls()).toBe(1);
  });

  it("opens a file row in the app, read-only for a viewer, and never on pages", async () => {
    route({
      list: () => [summary(), file("f1", "Báo giá.docx", { my_level: "view", current_version: 2 })],
    });
    const createSession = vi.fn<OfficeLaunchSessionFactory>().mockResolvedValue(null);
    renderView(vi.fn(), { desktopOpen: desktopOpenWith(createSession) });

    const fileRow = await rowOf("Báo giá.docx");
    const pageRow = await rowOf("Kế hoạch Q4");
    expect(within(pageRow).queryByRole("button", { name: t("office.desktop.row_action") })).toBeNull();

    // RFD-16: the row's actions are Star and the menu; the app command is the menu's Mở bằng UniWork Office.
    expect(within(fileRow).queryByRole("button", { name: t("office.desktop.row_action") })).toBeNull();
    expect(within(pageRow).queryByRole("menuitem", { name: t("documents.home.row.open_app") })).toBeNull();
    const actions = fileRow.querySelector<HTMLElement>("td[data-column='actions']")!;
    expect(within(actions).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      t("documents.home.row.star_item", { title: "Báo giá.docx" }),
      t("documents.home.row.menu", { title: "Báo giá.docx" }),
    ]);
    fireEvent.click(within(fileRow).getByRole("button", { name: t("documents.home.row.menu", { title: "Báo giá.docx" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.open_app") }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0]?.[0]).toBe("f1");
    expect(createSession.mock.calls[0]?.[1]).toMatchObject({ operation: "view", deployment_id: "dep-1" });
  });

  it("shows a file's size in the Dung lượng column", async () => {
    route({
      list: () => [
        summary({ id: "u1", kind: "file", title: "Hợp đồng.pdf", size_bytes: 2048, origin: "upload" }),
        summary({ id: "c1", kind: "file", title: "Báo cáo.docx", size_bytes: 0, origin: "created" }),
      ],
    });
    renderView(vi.fn());
    const uploaded = await rowOf("Hợp đồng.pdf");
    expect(within(uploaded).getAllByText(/2 KB/).length).toBeGreaterThan(0);
  });

  it("moves a row into a folder picked in the dialog, on the revision it reads first", async () => {
    route({
      list: () => [summary({ id: "d1" }), summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
      tree: () => [treeNode({ id: "f1", title: "Hợp đồng", kind: "folder" }), treeNode({ id: "d1", title: "Kế hoạch Q4" })],
      detail: (id) => summary({ id, revision: "7" }),
      post: (path) => (path.endsWith("/move") ? { document: summary({ id: "d1", parent_id: "f1", revision: "8" }) } : {}),
    });
    renderView(vi.fn());
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.move") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Hợp đồng" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => {
      const call = postCall("POST");
      expect(call?.[0]).toBe("/api/v1/documents/d1/move");
      expect((call?.[1] as { body?: unknown }).body).toEqual({ parent_id: "f1", revision: "7" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps a refused move in the dialog with the localized reason, and shows a folder and its subtree as aria-disabled", async () => {
    route({
      list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
      tree: () => [
        treeNode({ id: "f1", title: "Hợp đồng", kind: "folder", children: [treeNode({ id: "f2", title: "Con", kind: "folder", parent_id: "f1" })] }),
        treeNode({ id: "f3", title: "Tài chính", kind: "folder" }),
      ],
      detail: (id) => summary({ id, kind: "folder", revision: "2" }),
      post: () => {
        throw new ApiError("server text", "document_parent_kind", 422);
      },
    });
    renderView(vi.fn());
    await openFolderMenu("Hợp đồng");
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("treeitem", { name: "Hợp đồng" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("treeitem", { name: "Con" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Tài chính" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    expect(await within(dialog).findByText(t("documents.errors.document_parent_kind"))).toBeInTheDocument();
  });

  it("says archiving a folder takes everything in it", async () => {
    route({
      tree: () => [treeNode({ id: "f1", title: "Hợp đồng", kind: "folder" })],
      list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
    });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/f1/archive-impact"
        ? Promise.resolve({ folders: 2, documents: 3, total: 6, max_nodes: 1000, too_large: false })
        : base(path, opts),
    );
    renderView(vi.fn());
    await openFolderMenu("Hợp đồng");
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.delete") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("documents.archive.delete_title"))).toBeInTheDocument();
    expect(
      await within(dialog).findByText(
        t("documents.archive.delete_body", {
          subfolders: t("documents.archive.delete_subfolders", { count: 2 }),
          documents: t("documents.archive.delete_documents", { count: 3 }),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("offers the trash actions, never a live row command, on the trash view (UNI-2045 W2 menu)", async () => {
    route({
      list: (path) =>
        queryOf(path).get("archived") === "1"
          ? [summary({ archived_at: "2026-10-10T03:00:00Z", archived_by: "u2", purge_after: "2026-11-10T03:00:00Z" })]
          : [summary()],
    });
    renderView(vi.fn());
    await openView("trash");
    expect(await screen.findByRole("heading", { level: 1, name: t("documents.trash.title") })).toBeInTheDocument();
    const row = await rowOf("Kế hoạch Q4");
    expect(within(row).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: t("documents.trash.purge") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.move") })).toBeNull();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await openView("shared");
    const sharedRow = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(sharedRow).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") });
    // Shared with me shares the live row menu (UNI-2045 W8): this row is managed, so it carries both commands;
    // the edit-level case is pinned in documents-row-menu.test.tsx.
    expect(screen.getByRole("menuitem", { name: t("documents.home.row.move") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.home.row.archive") })).toBeInTheDocument();
  });

  it("gates Move and Archive by the level of each row, not by the open folder", async () => {
    route({
      list: () => [
        summary({ id: "m1", title: "Báo cáo quản lý", my_level: "manage" }),
        summary({ id: "e1", title: "Tài liệu được sửa", my_level: "edit" }),
        summary({ id: "v1", title: "Tài liệu chỉ đọc", my_level: "view" }),
        summary({ id: "n1", title: "Chưa rõ", my_level: undefined }),
      ],
    });
    renderView(vi.fn());
    const menuItems = async (title: string) => {
      const row = await rowOf(title);
      fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
      await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") });
      const has = (key: string) => screen.queryByRole("menuitem", { name: t(key) }) !== null;
      const out = { move: has("documents.home.row.move"), archive: has("documents.home.row.archive") };
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeNull());
      return out;
    };
    expect(await menuItems("Báo cáo quản lý")).toEqual({ move: true, archive: true });
    expect(await menuItems("Tài liệu được sửa")).toEqual({ move: true, archive: false });
    expect(await menuItems("Tài liệu chỉ đọc")).toEqual({ move: false, archive: false });
    // A row the server sent no level for reads as view: nothing it would refuse.
    expect(await menuItems("Chưa rõ")).toEqual({ move: false, archive: false });
  });

  it("opens an editable row in the app with an edit session and a view-only row read-only", async () => {
    route({
      list: () => [
        file("f1", "Sửa.docx", { my_level: "edit", current_version: 2 }),
        file("f2", "Xem.docx", { my_level: "view", current_version: 2 }),
      ],
    });
    const createSession = vi.fn<OfficeLaunchSessionFactory>().mockResolvedValue(null);
    renderView(vi.fn(), { desktopOpen: desktopOpenWith(createSession) });
    for (const [title, id, operation] of [["Sửa.docx", "f1", "edit"], ["Xem.docx", "f2", "view"]] as const) {
      createSession.mockClear();
      fireEvent.click(within(await rowOf(title)).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
      fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.open_app") }));
      await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
      expect(createSession.mock.calls[0]?.[0]).toBe(id);
      expect(createSession.mock.calls[0]?.[1]).toMatchObject({ operation });
    }
  });

  it("puts Open UniWork Office in the header, launching the app with no document", async () => {
    route({ list: () => [] });
    const launch = vi.fn(async () => "launched" as const);
    renderView(vi.fn(), {
      officeHome: {
        channel: "stable",
        launch,
        loadInstallers: vi.fn(async () => ({ installers: [] })),
        loadPlatformHint: vi.fn(async () => ({ platform: "win32-x64" as const, confidence: "certain" as const })),
        downloadInstaller: vi.fn(async () => "UniWork-Office.exe"),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.open_office") }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("uniwork-office://home", expect.anything()));
    expect(postCall("POST")).toBeUndefined();
  });

  it("says a chat file says View where attached, and offers no save for a file the server will not copy", async () => {
    route({ list: () => [], sources: () => [source({ can_save: false })] });
    renderView(vi.fn());
    const row = await rowOf("Đề xuất ngân sách.pdf");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách.pdf" }) }));
    expect(await screen.findByRole("menuitem", { name: "Xem nơi đính kèm" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.save_to_folder") })).toBeNull();
    expect(screen.getByRole("menuitem", { name: t("documents.home.row.download") })).toBeInTheDocument();
  });

  it("explains a refused save in the dialog", async () => {
    route({
      list: () => [],
      sources: () => [source()],
      post: () => {
        throw new ApiError("server text", "source_not_saveable", 422);
      },
    });
    renderView(vi.fn());
    const row = await rowOf("Đề xuất ngân sách.pdf");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách.pdf" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.save_to_folder") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));
    expect(await within(dialog).findByText(t("documents.errors.source_not_saveable"))).toBeInTheDocument();
  });

  it("disables move targets past the depth limit with the localized reason", async () => {
    const chain = (level: number): ReturnType<typeof treeNode> =>
      treeNode({
        id: `l${level}`,
        title: `Cấp ${level}`,
        kind: "folder",
        children: level < TREE_MAX_LEVEL ? [chain(level + 1)] : [],
      });
    route({
      list: () => [summary({ id: "d1" })],
      tree: () => [chain(1), treeNode({ id: "d1", title: "Kế hoạch Q4", children: [treeNode({ id: "d2", title: "Con" })] })],
    });
    renderView(vi.fn());
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.move") }));
    const dialog = await screen.findByRole("dialog");
    // A page with one child takes two levels: TREE_MAX_LEVEL - 2 is the deepest enabled target.
    expect(within(dialog).getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL - 2}` })).not.toHaveAttribute("aria-disabled");
    const tooDeep19 = within(dialog).getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL - 1}` });
    const tooDeep20 = within(dialog).getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL}` });
    expect(tooDeep19).toHaveAttribute("aria-disabled", "true");
    expect(tooDeep19).toHaveAccessibleDescription(t("documents.home.move.reason_too_deep", { max: TREE_MAX_LEVEL }));
    expect(tooDeep20).toHaveAttribute("aria-disabled", "true");
    expect(tooDeep20).toHaveAccessibleDescription(t("documents.home.move.reason_too_deep", { max: TREE_MAX_LEVEL }));
  });

  it("explains a folder too large to archive at once", async () => {
    route({
      tree: () => [treeNode({ id: "f1", title: "Hợp đồng", kind: "folder" })],
      list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
      post: () => {
        throw new ApiError("server text", "folder_too_large", 422);
      },
    });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/f1/archive-impact"
        ? Promise.resolve({ folders: 0, documents: 0, total: 1, max_nodes: 1000, too_large: false })
        : base(path, opts),
    );
    renderView(vi.fn());
    await openFolderMenu("Hợp đồng");
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.delete") }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: t("documents.archive.delete_confirm") });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await within(dialog).findByText(t("documents.errors.folder_too_large"))).toBeInTheDocument();
  });

  it("uploads a file from the header button and opens the new document", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], upload: () => ({ document: file("d2", "note.txt") }) });
    renderView(onOpen);

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, { target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] } });
    expect(screen.getByTestId("document-upload-selected")).toHaveTextContent("note.txt");

    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d2"));
  });

  it("keeps a failed upload in the dialog with the reason", async () => {
    route({
      list: () => [],
      upload: () => {
        throw new Error("boom");
      },
    });
    renderView(vi.fn());

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, { target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    // The picked file is still there, so the retry does not re-pick it.
    expect(screen.getByTestId("document-upload-selected")).toBeInTheDocument();
  });

  it("uploads files dropped on the library into the open view", async () => {
    route({ list: () => [], upload: () => ({ document: file("d3", "drop.txt") }) });
    renderView(vi.fn());
    const zone = await screen.findByRole("region", { name: t("documents.page.title") });
    const dropped = new File(["x"], "drop.txt", { type: "text/plain" });

    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [dropped] } });

    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === `${LIST_BASE}/files`)).toBe(true));
  });

  it("refuses a file over upload_max_bytes before sending any upload request", async () => {
    const uploadSpy = vi.fn();
    route({ list: () => [], upload: uploadSpy });
    renderView(vi.fn());

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Tối đa 200 MB mỗi tệp.")).toBeInTheDocument();
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const huge = new File(["x"], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(huge, "size", { value: 200 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [huge] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("documents.upload.too_large_named", { name: "huge.pdf", size: "200,1 MB", max: "200 MB" }),
    );
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(requestMock.mock.calls.some(([path]) => path === `${LIST_BASE}/files`)).toBe(false);
  });

  it("renders {{max}} from error.fields.max_bytes when the server answers 413 file_too_large", async () => {
    route({
      list: () => [],
      upload: () => {
        throw new ApiError("tệp vượt quá dung lượng cho phép", "file_too_large", 413, undefined, {
          max_bytes: 50 * 1024 * 1024,
        });
      },
    });
    renderView(vi.fn());

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const big = new File(["x"], "report.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 60 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("documents.upload.too_large_named", { name: "report.pdf", size: "60 MB", max: "50 MB" }),
    );
  });


  describe("folder contents list (FD-08)", () => {
    const rowOrder = () =>
      Array.from(document.querySelectorAll("[data-library-row]")).map((tr) =>
        tr.getAttribute("data-library-row"),
      );


    it("keeps subfolders out of the rows, as cards above the table, in both sorts", async () => {
      route({
        tree: () => [
          treeNode({
            id: "fo1",
            title: "Dự án CCB",
            kind: "folder",
            children: [
              treeNode({ id: "fol-old", title: "Zebra", kind: "folder", parent_id: "fo1" }),
              treeNode({ id: "fol-new", title: "Alpha", kind: "folder", parent_id: "fo1" }),
            ],
          }),
        ],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) =>
          queryOf(path).get("parent_id") === "fo1"
            ? [
                summary({ id: "doc-new", parent_id: "fo1", kind: "page", title: "Zulu", updated_at: "2026-10-10T00:00:00Z" }),
                summary({ id: "fol-old", parent_id: "fo1", kind: "folder", title: "Zebra", updated_at: "2026-01-01T00:00:00Z" }),
                file("doc-old", "Báo cáo.docx", { parent_id: "fo1", updated_at: "2026-02-01T00:00:00Z" }),
                summary({ id: "fol-new", parent_id: "fo1", kind: "folder", title: "Alpha", updated_at: "2026-09-01T00:00:00Z" }),
              ]
            : [],
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      const subfolders = await screen.findByRole("region", { name: sectionName("subfolders") });
      await within(subfolders).findByRole("button", { name: /^Zebra/ });
      expect(within(subfolders).getByRole("button", { name: /^Alpha/ })).toBeInTheDocument();
      await screen.findByText("Zulu");
      // Newest update first; the folders are cards, never rows.
      expect(rowOrder()).toEqual(["doc-new", "doc-old"]);

      await clickSort("name");
      await waitFor(() => expect(rowOrder()).toEqual(["doc-old", "doc-new"]));
      expect(within(subfolders).getByRole("button", { name: /^Zebra/ })).toBeInTheDocument();
    });

    it("sorts by Name using Vietnamese collation ('Ă' after 'A')", async () => {
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) =>
          queryOf(path).get("parent_id") === "fo1"
            ? [
                summary({ id: "binh", parent_id: "fo1", kind: "page", title: "Bình", updated_at: "2026-10-04T00:00:00Z" }),
                summary({ id: "an-circumflex", parent_id: "fo1", kind: "page", title: "Ân", updated_at: "2026-10-03T00:00:00Z" }),
                summary({ id: "an-breve", parent_id: "fo1", kind: "page", title: "Ăn", updated_at: "2026-10-02T00:00:00Z" }),
                summary({ id: "an-plain", parent_id: "fo1", kind: "page", title: "An", updated_at: "2026-10-01T00:00:00Z" }),
              ]
            : [],
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });
      await screen.findByText("Bình");

      await clickSort("name");
      await waitFor(() => expect(rowOrder()).toEqual(["an-plain", "an-breve", "an-circumflex", "binh"]));
    });

    it("keeps the chosen sort on the control and in storage after going to root (control unmounts) and opening another folder (V-F1)", async () => {
      const setItemSpy = vi.spyOn(defaultStorage, "setItem");
      route({
        tree: () => [
          treeNode({ id: "fo1", title: "Thư mục A", kind: "folder" }),
          treeNode({ id: "fo2", title: "Thư mục B", kind: "folder" }),
        ],
        detail: (id) =>
          id === "fo1"
            ? folderDetail({ id: "fo1", title: "Thư mục A" })
            : id === "fo2"
              ? folderDetail({ id: "fo2", title: "Thư mục B" })
              : null,
        list: (path) => {
          const pid = queryOf(path).get("parent_id");
          if (pid === "fo1") {
            return [
              summary({ id: "a-z", parent_id: "fo1", title: "Zeta", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "a-a", parent_id: "fo1", title: "Alpha", updated_at: "2026-01-01T00:00:00Z" }),
            ];
          }
          if (pid === "fo2") {
            return [
              summary({ id: "b-an-breve", parent_id: "fo2", title: "Ăn", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "b-an", parent_id: "fo2", title: "An", updated_at: "2026-01-01T00:00:00Z" }),
            ];
          }
          return [summary({ id: "root-doc", title: "Tài liệu gốc" })];
        },
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });
      await screen.findByText("Zeta");
      expect(rowOrder()).toEqual(["a-z", "a-a"]);

      await clickSort("name");
      await waitFor(() => expect(rowOrder()).toEqual(["a-a", "a-z"]));

      // Go to root so the sort Select unmounts and the home filters mount, then open another folder.
      const crumbs = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
      fireEvent.click(within(crumbs).getByRole("button", { name: t("documents.home.sidebar.home") }));
      await screen.findByText("Tài liệu gốc");
      expect(typeFilterSelect()).toBeInTheDocument();

      setItemSpy.mockClear();
      fireEvent.click(screen.getByRole("treeitem", { name: /Thư mục B/ }));
      await screen.findByText("Ăn");
      expect(headerOf("name")).toHaveAttribute("aria-sort", "ascending");
      expect(rowOrder()).toEqual(["b-an", "b-an-breve"]);
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(storedSort("u1")).toEqual({ workspace: { column: "name", order: "asc" } });
      setItemSpy.mockRestore();
    });

    it("persists the sort choice under one per-viewer key (uniwork_documents_folder_sort:<userId>), isolates viewers, and does not write without a user (F2)", async () => {
      const setItemSpy = vi.spyOn(defaultStorage, "setItem");
      route({
        tree: () => [
          treeNode({ id: "fo1", title: "Thư mục A", kind: "folder" }),
          treeNode({ id: "fo2", title: "Thư mục B", kind: "folder" }),
        ],
        detail: (id) =>
          id === "fo1"
            ? folderDetail({ id: "fo1", title: "Thư mục A" })
            : id === "fo2"
              ? folderDetail({ id: "fo2", title: "Thư mục B" })
              : null,
        list: (path) => {
          const pid = queryOf(path).get("parent_id");
          if (pid === "fo1") {
            return [
              summary({ id: "a-z", parent_id: "fo1", title: "Zeta", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "a-a", parent_id: "fo1", title: "Alpha", updated_at: "2026-01-01T00:00:00Z" }),
            ];
          }
          if (pid === "fo2") {
            return [
              summary({ id: "b-an-breve", parent_id: "fo2", title: "Ăn", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "b-an", parent_id: "fo2", title: "An", updated_at: "2026-01-01T00:00:00Z" }),
            ];
          }
          return [];
        },
      });
      const { unmount } = renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });
      await screen.findByText("Zeta");
      await clickSort("name");
      await waitFor(() => expect(rowOrder()).toEqual(["a-a", "a-z"]));
      expect(storedSort("u1")).toEqual({ workspace: { column: "name", order: "asc" } });
      expect(setItemSpy).toHaveBeenCalledWith(userSortKey("u1"), JSON.stringify({ workspace: { column: "name", order: "asc" } }));

      fireEvent.click(screen.getByRole("treeitem", { name: /Thư mục B/ }));
      await screen.findByText("Ăn");
      expect(rowOrder()).toEqual(["b-an", "b-an-breve"]);

      // A second viewer on the same browser does not share u1's choice, and no user neither reads nor writes.
      unmount();
      setSessionUser({
        id: "u2",
        email: "binh@example.com",
        display_name: "Bình",
        onboarded_at: "2026-08-25T00:00:00Z",
        email_verified_at: "2026-08-25T00:00:00Z",
        onboarding_questionnaire: {},
        locale: "vi",
      });
      const second = renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo2` });
      await screen.findByText("Ăn");
      expect(rowOrder()).toEqual(["b-an-breve", "b-an"]);
      expect(storedSort("u2")).toBeNull();
      second.unmount();

      resetAuthStoreForTests();
      setItemSpy.mockClear();
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo2` });
      await screen.findByText("Ăn");
      expect(rowOrder()).toEqual(["b-an-breve", "b-an"]);
      await clickSort("name");
      await waitFor(() => expect(rowOrder()).toEqual(["b-an", "b-an-breve"]));
      expect(setItemSpy).not.toHaveBeenCalled();
      setItemSpy.mockRestore();
    });

    it("loads all pages of an open folder before applying sort (F4)", async () => {
      const urls: string[] = [];
      route({
        tree: () => [
          treeNode({
            id: "fo1",
            title: "Dự án CCB",
            kind: "folder",
            children: [treeNode({ id: "fol-p2", title: "Thư mục trang 2", kind: "folder", parent_id: "fo1" })],
          }),
        ],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) => {
          urls.push(path);
          const pid = queryOf(path).get("parent_id");
          const cur = queryOf(path).get("cursor");
          if (pid === "fo1") {
            if (cur === "c2") {
              return [
                summary({ id: "fol-p2", parent_id: "fo1", kind: "folder", title: "Thư mục trang 2", updated_at: "2026-01-01T00:00:00Z" }),
                summary({ id: "doc-p2", parent_id: "fo1", kind: "page", title: "Bình", updated_at: "2026-05-01T00:00:00Z" }),
              ];
            }
            return [
              summary({ id: "doc-p1-new", parent_id: "fo1", kind: "page", title: "Zeta", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "doc-p1-old", parent_id: "fo1", kind: "page", title: "An", updated_at: "2026-08-01T00:00:00Z" }),
            ];
          }
          if (pid === "fo-cap") {
            // Under the docx chip the server answers docx files only. Each full
            // page counts toward the 1000-row cap, but only the one direct child
            // (page 2's last row) renders: the rest sit in a deeper folder, which
            // the open folder's direct-children filter drops.
            const batch = cur === "cap2" ? 500 : cur === "cap3" ? 1000 : 0;
            const format = queryOf(path).get("type");
            return Array.from({ length: 500 }, (_, i) => {
              const n = batch + i + 1;
              if (n === 1000) return file("cap-1000", "Tài liệu 1000.docx", { parent_id: "fo-cap", updated_at: "2026-10-01T00:00:00Z" });
              if (format) return file(`deep-${n}`, `Sâu ${n}.docx`, { parent_id: "fo-deep", updated_at: "2026-10-01T00:00:00Z" });
              return summary({ id: `cap-${n}`, parent_id: "fo-cap", kind: "page", title: `Tài liệu ${n}`, updated_at: "2026-10-01T00:00:00Z" });
            });
          }
          return [];
        },
        cursor: (path) => {
          const pid = queryOf(path).get("parent_id");
          const cur = queryOf(path).get("cursor");
          if (pid === "fo1") return cur === "c2" ? null : "c2";
          return null;
        },
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      // Without clicking Load more, page 2 is auto-loaded: its document joins the rows (newest first)
      // and its folder is a card, not a row.
      await screen.findByText("Bình");
      expect(rowOrder()).toEqual(["doc-p1-new", "doc-p1-old", "doc-p2"]);
      expect(screen.queryByRole("button", { name: t("documents.library.load_more") })).toBeNull();
      const subfolders = screen.getByRole("region", { name: sectionName("subfolders") });
      expect(within(subfolders).getByRole("button", { name: /^Thư mục trang 2/ })).toBeInTheDocument();

      await clickSort("name");
      await waitFor(() => expect(rowOrder()).toEqual(["doc-p1-old", "doc-p2", "doc-p1-new"]));
    });

    // The 1000-row cap lives on the rows useDocumentsLibrary returns; driving it
    // through the page rendered 1000 rows and needed a 90 s timeout, so the same
    // assertions run on the hook instead (same route stub, no DOM).
    it("stops an open folder's auto-paging at the 1000-row cap and keeps load-more working (F4)", async () => {
      const urls: string[] = [];
      route({
        tree: () => [treeNode({ id: "fo-cap", title: "Thư mục lớn", kind: "folder" })],
        list: (path) => {
          urls.push(path);
          const cur = queryOf(path).get("cursor");
          const batch = cur === "cap2" ? 500 : cur === "cap3" ? 1000 : 0;
          return Array.from({ length: 500 }, (_, i) => {
            const n = batch + i + 1;
            return summary({ id: `cap-${n}`, parent_id: "fo-cap", title: `Tài liệu ${n}`, updated_at: "2026-10-01T00:00:00Z" });
          });
        },
        cursor: (path) => {
          const cur = queryOf(path).get("cursor");
          return !cur ? "cap2" : cur === "cap2" ? "cap3" : null;
        },
      });
      const { result } = renderHook(
        () => useDocumentsLibrary({ wsId: WS, orgId: "org1", enabled: true, view: { kind: "home" }, folderId: "fo-cap", types: [] }),
        { wrapper: (props: { children: React.ReactNode }) => wrap(<>{props.children}</>) },
      );

      // Auto-pages fetch 500 + 500 = 1000 and stop before cap3.
      await waitFor(() => expect(result.current.state.rows).toHaveLength(1000));
      expect(result.current.state.loading).toBe(false);
      expect(urls.some((u) => queryOf(u).get("cursor") === "cap2")).toBe(true);
      expect(urls.some((u) => queryOf(u).get("cursor") === "cap3")).toBe(false);

      // The cap does not lock the list: manual load-more still fetches page 3.
      expect(result.current.state.hasMore).toBe(true);
      act(() => result.current.state.loadMore());
      await waitFor(() => expect(result.current.state.rows).toHaveLength(1500));
      expect(urls.some((u) => queryOf(u).get("cursor") === "cap3")).toBe(true);
    });

    it("lists direct children only and excludes grandchildren or root documents", async () => {
      const urls: string[] = [];
      route({
        tree: () => [
          treeNode({
            id: "fo1",
            title: "Dự án CCB",
            kind: "folder",
            children: [treeNode({ id: "sub1", title: "Con trực tiếp", kind: "folder", parent_id: "fo1" })],
          }),
        ],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) => {
          urls.push(path);
          return [
            summary({ id: "sub1", parent_id: "fo1", kind: "folder", title: "Con trực tiếp" }),
            file("direct-doc", "Tài liệu con.docx", { parent_id: "fo1" }),
            file("grandchild-doc", "Tài liệu cháu.docx", { parent_id: "sub1" }),
            summary({ id: "root-doc", parent_id: null, title: "Tài liệu gốc" }),
          ];
        },
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      const table = await screen.findByRole("table");
      const subfolders = await screen.findByRole("region", { name: sectionName("subfolders") });
      expect(await within(subfolders).findByRole("button", { name: /^Con trực tiếp/ })).toBeInTheDocument();
      expect(within(table).queryByText("Con trực tiếp")).toBeNull();
      expect(within(table).getByText("Tài liệu con.docx")).toBeInTheDocument();
      expect(within(table).queryByText("Tài liệu cháu.docx")).toBeNull();
      expect(within(table).queryByText("Tài liệu gốc")).toBeNull();
      expect(urls.some((u) => queryOf(u).get("parent_id") === "fo1")).toBe(true);
    });

    it("keeps root and folder apart per FD-D9: the same filter bar in both (UNI-2045 W10), the sort in the table headers of both, never grouped", async () => {
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) =>
          queryOf(path).get("parent_id") === "fo1"
            ? [file("f1", "Báo giá.docx", { parent_id: "fo1" })]
            : [summary({ id: "d1", title: "Kế hoạch Q4" }), file("f1", "Báo giá.docx", { parent_id: "fo1" })],
      });
      renderView(vi.fn());
      await screen.findByText("Báo giá.docx");

      expect(noSortSelect()).toBe(true);
      expect(typeFilterSelect()).toBeInTheDocument();
      expect(screen.queryByText("Nhóm theo")).toBeNull();
      expect(screen.queryByRole("columnheader", { name: t("documents.home.columns.type") })).toBeNull();
      expect(headerOf("updated")).toHaveAttribute("aria-sort", "descending");
      const groupHeaders = () => Array.from(document.querySelectorAll("[data-library-group]")).map((c) => c.textContent);
      // The home table is flat: no "Chưa phân loại" / folder group headings.
      expect(groupHeaders()).toEqual([]);

      fireEvent.click(screen.getByRole("treeitem", { name: /Dự án CCB/ }));
      await screen.findByRole("columnheader", { name: t("documents.home.columns.access") });
      expect(noSortSelect()).toBe(true);
      expect(headerOf("updated")).toHaveAttribute("aria-sort", "descending");
      expect(typeFilterSelect()).toBeInTheDocument();
      expect(screen.queryByText("Nhóm theo")).toBeNull();
      // Same six board columns inside a folder (F-7): Truy cập, never Loại.
      expect(screen.queryByRole("columnheader", { name: t("documents.home.columns.type") })).toBeNull();
      expect(await screen.findByRole("columnheader", { name: t("documents.home.columns.access") })).toBeInTheDocument();
      expect(groupHeaders()).toEqual([]);
    });

    it("renders CollectionPageState when an open folder is empty and offers a New folder action when the viewer can create (V-F3)", async () => {
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: () => [],
        post: () => ({ document: folderDetail({ id: "fo-sub", parent_id: "fo1", title: "Thư mục con mới" }) }),
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      const emptyTitle = await screen.findByText(t("documents.home.empty.folder_title"));
      expect(emptyTitle).toBeInTheDocument();
      const status = emptyTitle.closest("[role='status']") as HTMLElement;
      expect(status).toHaveTextContent(t("documents.home.empty.description"));
      expect(noSortSelect()).toBe(true);
      expect(screen.queryByRole("table")).toBeNull();

      const createFolderBtn = within(status).getByRole("button", { name: t("documents.home.folders.create_title") });
      fireEvent.click(createFolderBtn);
      const dialog = await screen.findByRole("dialog", {
        name: t("documents.home.folders.create_sub_title", { parent: "Dự án CCB" }),
      });
      const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
      fireEvent.change(input, { target: { value: "Thư mục con mới" } });
      fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));
      await waitFor(() => {
        expect((postCall("POST")?.[1] as { body?: unknown }).body).toEqual({
          kind: "folder",
          title: "Thư mục con mới",
          parent_id: "fo1",
        });
      });
    });


    it("defaults sort without crashing when platform storage throws", async () => {
      const getSpy = vi.spyOn(defaultStorage, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      const setSpy = vi.spyOn(defaultStorage, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) =>
          queryOf(path).get("parent_id") === "fo1"
            ? [
                summary({ id: "d-old", parent_id: "fo1", title: "An", updated_at: "2026-01-01T00:00:00Z" }),
                summary({ id: "d-new", parent_id: "fo1", title: "Zeta", updated_at: "2026-10-10T00:00:00Z" }),
              ]
            : [],
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      await screen.findByText("Zeta");
      expect(rowOrder()).toEqual(["d-new", "d-old"]);

      await clickSort("name");
      await waitFor(() => expect(rowOrder()).toEqual(["d-old", "d-new"]));

      getSpy.mockRestore();
      setSpy.mockRestore();
    });

    it("gives every breadcrumb button and, on the Recent view, every filter-bar select a 44px coarse-pointer floor (V-F6 / N3)", async () => {
      route({
        tree: () => [
          treeNode({
            id: "fo1",
            title: "An",
            kind: "folder",
            children: [treeNode({ id: "fo2", title: "Dự án CCB", kind: "folder", parent_id: "fo1" })],
          }),
        ],
        detail: (id) =>
          id === "fo2"
            ? folderDetail({ id: "fo2", title: "Dự án CCB", parent_id: "fo1", breadcrumbs: [{ id: "fo1", title: "An" }] })
            : null,
        list: () => [summary({ id: "d1", parent_id: "fo2", title: "Kế hoạch Q4" })],
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo2` });
      await screen.findByText("Kế hoạch Q4");

      // A folder carries the shared filter bar (UNI-2045 W10) and no scope tabs.
      expect(typeFilterSelect()).toBeInTheDocument();
      const crumbs = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
      for (const btn of within(crumbs).getAllByRole("button")) {
        expect(btn).toHaveClass("pointer-coarse:min-w-11", "pointer-coarse:min-h-11");
      }

      await openView("recent");
      await screen.findByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.type")}`) });
      for (const name of ["type", "editor", "updated"]) {
        const select = screen.getByRole("combobox", { name: new RegExp(`^${t(`documents.home.filters.${name}`)}`) });
        expect(select).toHaveClass("h-8", "px-3", "pointer-coarse:h-11", "pointer-coarse:min-h-11");
      }
    });

    // The Loại select is a FilterSelect like Người sửa and Cập nhật (UNI-2113): same
    // control style, same width rules, so the row wraps as a whole at 390px.
    it("draws the Loại select with the very classes of Người sửa and Cập nhật", async () => {
      route({ list: () => [summary({ id: "d1", title: "Kế hoạch Q4" })] });
      renderView(vi.fn());
      await screen.findByText("Kế hoạch Q4");
      await openView("recent");

      const classes = (name: string) =>
        screen.getByRole("combobox", { name: new RegExp(`^${t(`documents.home.filters.${name}`)}`) }).className;
      expect(classes("type")).toBe(classes("editor"));
      expect(classes("type")).toBe(classes("updated"));
    });
  });

  describe("legacy Office formats (.doc, .xls, .ppt)", () => {
    it("opens LegacyFormatDialog instead of navigating when clicking a legacy row, and supports Mở bằng UniWork Office", async () => {
      const onOpen = vi.fn();
      const createSession = vi.fn().mockResolvedValue({
        launch_ticket: `ticket_${"a".repeat(32)}`,
        launch_url: `uniwork-office://open?ticket=ticket_${"a".repeat(32)}`,
        expires_at: "2026-10-26T00:00:00Z",
        document_id: "d-doc",
        operation: "edit",
        version: 1,
      });
      route({
        list: () => [
          file("d-doc", "Hợp đồng cũ.doc", { format: "doc" }),
          file("d-docx", "Hợp đồng mới.docx", { format: "docx" }),
        ],
      });
      renderView(onOpen, { desktopOpen: desktopOpenWith(createSession) });

      const legacyRow = await rowOf("Hợp đồng cũ.doc");
      fireEvent.click(within(legacyRow).getByRole("button", { name: /^File Hợp đồng cũ\.doc/ }));

      expect(onOpen).not.toHaveBeenCalled();
      const dialog = await screen.findByRole("dialog", { name: t("office.legacy.title") });
      expect(dialog).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: t("office.desktop.action") }));
      await waitFor(() => expect(createSession).toHaveBeenCalledWith("d-doc", expect.objectContaining({
        operation: "edit",
        deployment_id: "dep-1",
      })));
    });

    it("opens LegacyFormatDialog instead of navigating when clicking a legacy RecentContinue card", async () => {
      const onOpen = vi.fn();
      route({
        list: () => [
          file("d-xls", "Ngân sách 2024.xls", {
            format: "xls",
            last_activity: { kind: "edited", at: "2026-10-25T10:00:00Z" },
          }),
        ],
      });
      renderView(onOpen, { initialUrl: `/org/${WS}/documents?view=recent` });

      const continueRegion = await screen.findByRole("region", { name: t("documents.recent.continue_title") });
      fireEvent.click(within(continueRegion).getByRole("button", { name: /Ngân sách 2024\.xls/ }));

      expect(onOpen).not.toHaveBeenCalled();
      expect(await screen.findByRole("dialog", { name: t("office.legacy.title") })).toBeInTheDocument();
    });
  });
});

/* ---- helpers --------------------------------------------------------------- */

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function file(id: string, title: string, over: Record<string, unknown> = {}) {
  return summary({
    id,
    kind: "file",
    title,
    organization_id: "org1",
    current_version: 1,
    my_level: "edit",
    file: {
      file_id: `file-${id}`,
      version_id: "v1",
      version: 1,
      filename: title,
      mime_type: "application/octet-stream",
      size_bytes: 5,
      checksum_sha256: "a".repeat(64),
    },
    ...over,
  });
}

function folderDetail(over: Record<string, unknown> = {}) {
  return summary({ id: "fo1", kind: "folder", title: "Dự án CCB", revision: "3", my_level: "manage", breadcrumbs: [], ...over });
}

function source(over: Record<string, unknown> = {}) {
  return {
    id: "chat:m1",
    source: "chat",
    parent: { kind: "chat_channel", id: "c1", title: "Kênh chung" },
    name: "Đề xuất ngân sách.pdf",
    mime_type: "application/pdf",
    extension: "pdf",
    size_bytes: 2_400_000,
    updated_at: "2026-10-09T03:00:00Z",
    owner: { id: "u2", kind: "human", name: "Dũng" },
    can_open_in_app: true,
    can_save: true,
    ...over,
  };
}

interface Routes {
  tree?: () => unknown[];
  list?: (path: string) => unknown[];
  cursor?: (path: string) => string | null;
  sources?: () => unknown[];
  detail?: (id: string) => unknown;
  post?: (path: string) => unknown;
  patch?: () => unknown;
  upload?: () => unknown;
}

/** One transport stub for the whole screen; anything unrouted answers `{}`. */
function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    const run = (fn: () => unknown) => {
      try {
        return Promise.resolve(fn());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    if (path.startsWith(TREE_URL)) return run(() => ({ documents: routes.tree?.() ?? [] }));
    if (path === `${LIST_BASE}/files`) return run(() => routes.upload?.() ?? {});
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      return run(() => ({ items: routes.sources?.() ?? [], next_cursor: null }));
    }
    if (method === "POST") return run(() => routes.post?.(path) ?? {});
    if (method === "PATCH") return run(() => routes.patch?.() ?? {});
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      return run(() => {
        const doc = routes.detail?.(path.split("/")[4]?.split("?")[0] ?? "");
        return doc ? { document: doc } : {};
      });
    }
    if (path.startsWith(LIST_BASE)) {
      return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: routes.cursor?.(path) ?? null }));
    }
    return Promise.resolve({});
  });
}

function sourceCalls() {
  return requestMock.mock.calls.filter(([path]) => String(path).startsWith(`${LIST_BASE}/sources`)).length;
}

/** A pill of the Tạo nhanh strip at the home root. */
async function pillButton(type: string) {
  const strip = await screen.findByRole("region", { name: t("documents.home.quick_create.label") });
  return within(strip).getByRole("button", { name: new RegExp(escape(t(`documents.home.create.${type}.chip`))) });
}

/** Switches the view through the sidebar nav (the scope tabs are gone). */
async function openView(view: "home" | "recent" | "starred" | "shared" | "shared_by_me" | "trash") {
  const buttons = await screen.findAllByRole("button", { name: t(`documents.home.sidebar.${view}`) });
  fireEvent.click(buttons[0]!);
}

/** The section regions are named by their h2, which carries the count ("Thư mục 1"). */
function sectionName(key: "folders" | "subfolders" | "documents") {
  return new RegExp(`^${escape(t(`documents.home.sections.${key}`))} [0-9]+$`);
}

/** Opens the ⋯ menu of a folder card (folders are cards, never table rows). */
async function openFolderMenu(title: string, regionName: RegExp = sectionName("folders")) {
  const section = await screen.findByRole("region", { name: regionName });
  fireEvent.click(await within(section).findByRole("button", { name: t("documents.home.row.menu", { title }) }));
}

async function rowOf(title: string) {
  const table = await screen.findByRole("table");
  const name = await within(table).findByText(title);
  const row = name.closest("tr");
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

function desktopOpenWith(createSession: OfficeLaunchSessionFactory) {
  return () => ({
    deploymentId: "dep-1",
    savedVersion: 1,
    createSession,
    launch: vi.fn().mockResolvedValue("launched"),
  });
}
