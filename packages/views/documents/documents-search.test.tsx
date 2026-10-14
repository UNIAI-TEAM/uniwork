import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { paths } from "@uniwork/core/paths";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

const { t } = initI18n();

const WS = "ws1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const user: User = {
  id: "u1",
  email: "an@example.com",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

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

function queryOf(path: string) {
  return new URLSearchParams(path.split("?")[1] ?? "");
}

function createNav(initialSearch = ""): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents",
    searchParams: new URLSearchParams(initialSearch),
    getShareableUrl: (p) => p,
  };
}

function renderSearchView(nav: NavigationAdapter = createNav(), onOpen = vi.fn()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrap(
      <NavigationProvider value={nav}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={onOpen} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  return { nav, onOpen };
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("Documents unified search (FD-10)", () => {
  it("typing 'hop dong' queries q=hop dong & match=title and renders folders and documents with paths", async () => {
    const searchUrls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        searchUrls.push(path);
        return Promise.resolve({
          documents: [
            summary({
              id: "fo-hd",
              kind: "folder",
              title: "Hợp đồng 2026",
              path: [{ id: "fo-root", title: "Pháp chế" }],
            }),
            summary({
              id: "doc-hd",
              kind: "file",
              title: "Hợp đồng lao động.docx",
              path: [
                { id: "fo-root", title: "Pháp chế" },
                { id: "fo-hd", title: "Hợp đồng 2026" },
              ],
            }),
          ],
          next_cursor: null,
        });
      }
      if (path.startsWith(LIST_BASE)) {
        return Promise.resolve({ documents: [summary({ id: "home-doc", title: "Tài liệu gốc" })], next_cursor: null });
      }
      return Promise.resolve({});
    });

    renderSearchView();
    expect(await screen.findByText("Tài liệu gốc")).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "hop dong" } });

    expect(await screen.findByText("Hợp đồng 2026")).toBeInTheDocument();
    expect(screen.getByText("Hợp đồng lao động.docx")).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu gốc")).toBeNull();

    expect(searchUrls.length).toBeGreaterThanOrEqual(1);
    const params = queryOf(searchUrls.at(-1)!);
    expect(params.get("q")).toBe("hop dong");
    expect(params.get("match")).toBe("title");
    expect(params.get("kind")).toBeNull();

    expect(screen.getByTitle("Pháp chế › Hợp đồng 2026")).toBeInTheDocument();
  });

  it("selecting the Folders chip sends kind=folder and shows only folders", async () => {
    const searchUrls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        searchUrls.push(path);
        const kind = queryOf(path).get("kind");
        if (kind === "folder") {
          return Promise.resolve({
            documents: [summary({ id: "fo-1", kind: "folder", title: "Hợp đồng đối tác", path: [] })],
            next_cursor: null,
          });
        }
        return Promise.resolve({
          documents: [
            summary({ id: "fo-1", kind: "folder", title: "Hợp đồng đối tác", path: [] }),
            summary({ id: "doc-1", kind: "page", title: "Hợp đồng mẫu", path: [] }),
          ],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "hop dong" } });

    expect(await screen.findByText("Hợp đồng mẫu")).toBeInTheDocument();

    const group = screen.getByRole("radiogroup", { name: t("documents.home.search.filter_label") });
    const folderRadio = within(group).getByRole("radio", { name: t("documents.home.search.filter_folder") });
    fireEvent.click(folderRadio);

    await waitFor(() => {
      expect(searchUrls.some((u) => queryOf(u).get("kind") === "folder" && queryOf(u).get("match") === "title")).toBe(true);
    });
    expect(await screen.findByText("Hợp đồng đối tác")).toBeInTheDocument();
    expect(screen.queryByText("Hợp đồng mẫu")).toBeNull();
  });

  it("arrow keys move and select chips in the radiogroup with roving tabindex", async () => {
    const searchUrls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        searchUrls.push(path);
        return Promise.resolve({ documents: [summary({ id: "fo-1", kind: "folder", title: "Hợp đồng" })], next_cursor: null });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "hop" } });

    const group = await screen.findByRole("radiogroup", { name: t("documents.home.search.filter_label") });
    const allRadio = within(group).getByRole("radio", { name: t("documents.home.search.filter_all") });
    const folderRadio = within(group).getByRole("radio", { name: t("documents.home.search.filter_folder") });
    const docRadio = within(group).getByRole("radio", { name: t("documents.home.search.filter_document") });

    expect(allRadio).toHaveAttribute("aria-checked", "true");
    expect(allRadio).toHaveAttribute("tabindex", "0");
    expect(folderRadio).toHaveAttribute("tabindex", "-1");
    expect(allRadio.className).toContain("min-w-11");

    allRadio.focus();
    fireEvent.keyDown(allRadio, { key: "ArrowRight" });

    expect(folderRadio).toHaveAttribute("aria-checked", "true");
    expect(folderRadio).toHaveAttribute("tabindex", "0");
    expect(allRadio).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(searchUrls.some((u) => queryOf(u).get("kind") === "folder")).toBe(true));

    fireEvent.keyDown(folderRadio, { key: "ArrowRight" });
    expect(docRadio).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(searchUrls.some((u) => queryOf(u).get("kind") === "document")).toBe(true));
  });

  it("pressing Escape or clearing the search box returns to the folder that was open", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path === "/api/v1/documents/fo-open") {
        return Promise.resolve({
          document: {
            id: "fo-open",
            workspace_id: WS,
            kind: "folder",
            title: "Thư mục đang mở",
            revision: "1",
            my_level: "manage",
            breadcrumbs: [{ id: "fo-open", title: "Thư mục đang mở" }],
          },
        });
      }
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        return Promise.resolve({
          documents: [summary({ id: "hit-1", title: "Kết quả tìm kiếm" })],
          next_cursor: null,
        });
      }
      if (path.startsWith(LIST_BASE) && queryOf(path).get("parent_id") === "fo-open") {
        return Promise.resolve({
          documents: [summary({ id: "in-folder", title: "Tài liệu trong thư mục" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    const nav = createNav("folder=fo-open");
    renderSearchView(nav);

    expect(await screen.findByText("Tài liệu trong thư mục")).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "ket qua" } });

    expect(await screen.findByText("Kết quả tìm kiếm")).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu trong thư mục")).toBeNull();

    const clearBtn = screen.getAllByRole("button", { name: t("documents.home.search.clear") })[0]!;
    expect(clearBtn.className).not.toContain("-translate-y-1/2");
    expect(clearBtn.className).toContain("inset-y-0");

    fireEvent.keyDown(searchInput, { key: "Escape" });

    expect(searchInput).toHaveValue("");
    expect(await screen.findByText("Tài liệu trong thư mục")).toBeInTheDocument();
    expect(screen.queryByText("Kết quả tìm kiếm")).toBeNull();
  });

  it("ignores input while IME isComposing and sends the query on compositionend", async () => {
    const searchUrls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        searchUrls.push(path);
        return Promise.resolve({
          documents: [summary({ id: "ime-hit", title: "Hợp đồng tiếng Việt" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [summary({ id: "root-item", title: "Trang gốc" })], next_cursor: null });
    });

    renderSearchView();
    expect(await screen.findByText("Trang gốc")).toBeInTheDocument();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });

    vi.useFakeTimers();
    try {
      fireEvent.compositionStart(searchInput);
      fireEvent.change(searchInput, { target: { value: "hơp" } });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      // No search request while composing, and folder content stays visible.
      expect(searchUrls).toEqual([]);
      expect(screen.getByText("Trang gốc")).toBeInTheDocument();

      fireEvent.compositionEnd(searchInput, { currentTarget: { value: "hợp đồng" }, target: { value: "hợp đồng" } });
      act(() => {
        vi.advanceTimersByTime(250);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText("Hợp đồng tiếng Việt")).toBeInTheDocument();
    expect(searchUrls).toHaveLength(1);
    expect(queryOf(searchUrls[0]!).get("q")).toBe("hợp đồng");
    expect(queryOf(searchUrls[0]!).get("match")).toBe("title");
  });

  it("activating a folder result navigates to the folder URL and a document result navigates to the document URL", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        return Promise.resolve({
          documents: [
            summary({ id: "fo-target", kind: "folder", title: "Thư mục đích" }),
            summary({ id: "doc-target", kind: "page", title: "Tài liệu đích" }),
          ],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    const wsPaths = paths.workspace("acme", "doi");
    const nav = createNav();
    const onOpen = vi.fn((id: string) => nav.push(wsPaths.document(id)));
    renderSearchView(nav, onOpen);
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "dich" } });

    const docBtn = await screen.findByRole("button", { name: /Tài liệu đích/ });
    fireEvent.click(docBtn);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("doc-target");
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith(wsPaths.document("doc-target"));

    const folderBtn = screen.getByRole("button", { name: /Thư mục đích/ });
    fireEvent.keyDown(folderBtn, { key: "Enter" });
    fireEvent.click(folderBtn);
    expect(nav.push).toHaveBeenCalledTimes(2);
    expect(nav.push).toHaveBeenLastCalledWith(wsPaths.documentsFolder("fo-target"));
  });

  it("renders CollectionPageState when search results are empty or when the query errors, without telling touch users to press Esc", async () => {
    let shouldFail = true;
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        if (shouldFail) return Promise.reject(new ApiError("boom", "internal", 500));
        return Promise.resolve({ documents: [], next_cursor: null });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "khong co" } });

    const alertState = await screen.findByRole("alert");
    expect(within(alertState).getByText(t("documents.home.search.error_title"))).toBeInTheDocument();

    shouldFail = false;
    fireEvent.click(within(alertState).getByRole("button", { name: t("documents.library.retry") }));

    expect(await screen.findByText(t("documents.home.search.empty_title"))).toBeInTheDocument();
    const emptyDesc = t("documents.home.search.empty_description");
    expect(emptyDesc).not.toMatch(/Esc/i);
    expect(screen.getByText(emptyDesc)).toBeInTheDocument();
  });

  it("prioritizes the title in result rows and truncates long paths from the left (applying per-segment cap only when the path does not fit)", async () => {
    const longAncestor = "Thư mục Dự án Chuyển đổi Số Toàn diện Tập đoàn Quốc tế 2026";
    const fittingAncestor = "Thư mục Dự án Chuyển đổi Số 2026"; // 32 chars (> 24, <= 36)
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        return Promise.resolve({
          documents: [
            summary({
              id: "deep-doc",
              kind: "page",
              title: "Báo cáo chi tiết",
              path: [
                { id: "p1", title: "Khối Vận hành" },
                { id: "p2", title: "Phòng Tài chính" },
                { id: "p3", title: "Ban Kế toán" },
                { id: "p4", title: "Năm 2026" },
                { id: "p5", title: "Quý 4" },
              ],
            }),
            summary({
              id: "long-parent-doc",
              kind: "page",
              title: "Biên bản nghiệm thu",
              path: [{ id: "p-long", title: longAncestor }],
            }),
            summary({
              id: "fitting-parent-doc",
              kind: "page",
              title: "Quyết định bổ nhiệm",
              path: [{ id: "p-fit", title: fittingAncestor }],
            }),
          ],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "bao cao" } });

    const titleEl = await screen.findByText("Báo cáo chi tiết");
    expect(titleEl).toBeInTheDocument();

    const fullPath = "Khối Vận hành › Phòng Tài chính › Ban Kế toán › Năm 2026 › Quý 4";
    // Visual truncated path starts with ellipsis from the left and keeps the full path in `title`
    const pathEl = screen.getByTitle(fullPath);
    expect(pathEl.textContent).toBe("… › Năm 2026 › Quý 4");
    expect(pathEl.className).not.toContain("shrink-0");
    // Title comes before path in DOM order so title keeps priority
    expect(titleEl.compareDocumentPosition(pathEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Screen reader text has the full path
    expect(screen.getByText(t("documents.home.search.path", { path: fullPath }))).toBeInTheDocument();

    const longAncestorEl = screen.getByTitle(longAncestor);
    expect(longAncestorEl.textContent?.startsWith("…")).toBe(true);
    expect(longAncestorEl.textContent!.length).toBeLessThan(longAncestor.length);
    expect(screen.getByText(t("documents.home.search.path", { path: longAncestor }))).toBeInTheDocument();

    // FE-R2-N2: a single 25-36 char ancestor that fits (<= 2 segments, <= 36 chars) is NOT capped at 24 chars
    const fittingAncestorEl = screen.getByTitle(fittingAncestor);
    expect(fittingAncestorEl.textContent).toBe(fittingAncestor);
  });

  it("keeps previous results visible without skeleton flicker while typing until the next query settles", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        const q = queryOf(path).get("q");
        if (q === "hop") {
          return Promise.resolve({
            documents: [summary({ id: "doc-first", title: "Hợp đồng khung" })],
            next_cursor: null,
          });
        }
        return Promise.resolve({
          documents: [summary({ id: "doc-second", title: "Hợp đồng phụ lục" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "hop" } });

    expect(await screen.findByText("Hợp đồng khung")).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      fireEvent.change(searchInput, { target: { value: "hop dong" } });
      // Previous result stays visible during debounce instead of flashing skeletons.
      expect(screen.getByText("Hợp đồng khung")).toBeInTheDocument();
      expect(screen.queryByLabelText(t("documents.home.search.loading"))).toBeNull();
      act(() => {
        vi.advanceTimersByTime(250);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText("Hợp đồng phụ lục")).toBeInTheDocument();
  });

  it("drops previousItems when switching from All to Folders chip so the skeleton shows instead of wrong-kind document rows while pending (FE-R2-N1)", async () => {
    let resolveFolderSearch: ((v: unknown) => void) | null = null;
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        if (queryOf(path).get("kind") === "folder") {
          return new Promise((resolve) => {
            resolveFolderSearch = resolve;
          });
        }
        return Promise.resolve({
          documents: [
            summary({ id: "fo-1", kind: "folder", title: "Thư mục Hợp đồng" }),
            summary({ id: "doc-1", kind: "page", title: "Tài liệu Hợp đồng" }),
          ],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "hop dong" } });

    expect(await screen.findByText("Tài liệu Hợp đồng")).toBeInTheDocument();

    const group = screen.getByRole("radiogroup", { name: t("documents.home.search.filter_label") });
    fireEvent.click(within(group).getByRole("radio", { name: t("documents.home.search.filter_folder") }));

    // While the Folders response is pending, the skeleton is shown and document rows from All are dropped.
    expect(await screen.findByLabelText(t("documents.home.search.loading"))).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu Hợp đồng")).toBeNull();

    act(() => {
      resolveFolderSearch?.({
        documents: [summary({ id: "fo-1", kind: "folder", title: "Thư mục Hợp đồng" })],
        next_cursor: null,
      });
    });

    expect(await screen.findByText("Thư mục Hợp đồng")).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu Hợp đồng")).toBeNull();
  });

  it("renders a single search box inside the header that wraps to a full-width row below sm and sits in the actions row from sm up (V-F1, V-F3)", () => {
    requestMock.mockResolvedValue({ documents: [], next_cursor: null });
    renderSearchView();

    const heading = screen.getByRole("heading", { level: 1, name: t("documents.page.title") });
    const header = heading.closest("header")!;
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    const searchBox = searchInput.parentElement!;

    expect(header.contains(searchBox)).toBe(true);
    expect(header.className).toContain("flex-wrap");
    expect(header.className).toContain("[&>div:last-child]:contents");
    expect(header.className).toContain("sm:[&>div:last-child]:flex");
    expect(searchBox.className).toContain("order-last");
    expect(searchBox.className).toContain("basis-full");
    expect(searchBox.className).toContain("sm:order-first");
    expect(searchBox.className).toContain("sm:w-48");
    expect(searchBox.className).toContain("md:w-64");
  });
});

