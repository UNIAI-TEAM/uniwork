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
import { pickTypeFilter, typeFilterSelect } from "../test/type-filter";
import { DocumentsPageView } from "./documents-page-view";
import type { LibraryDesktopOpen } from "./documents-library-row";

const { t } = initI18n();

const WS = "ws1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const MEMBERS_URL = `/api/v1/workspaces/${WS}/members`;
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

function summary(over: Record<string, unknown> = {}): Record<string, unknown> {
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

function renderSearchView(nav: NavigationAdapter = createNav(), onOpen = vi.fn(), desktopOpen?: LibraryDesktopOpen) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  const { unmount } = render(
    wrap(
      <NavigationProvider value={nav}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={onOpen} desktopOpen={desktopOpen} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  return { nav, onOpen, unmount };
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("Documents search keeps layout (UNI-2205)", () => {
  it("keeps the page layout while searching at home: header, Quick create, filter row, Thư mục N cards and Tài liệu N table with match counts, path line on subfolder matches, and no All/Folders/Documents pill row", async () => {
    const searchUrls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) {
        return Promise.resolve({
          documents: [
            { id: "fo-root", title: "Pháp chế", kind: "folder", position: 0, children: [] },
            { id: "fo-other", title: "Khác", kind: "folder", position: 1, children: [] },
          ],
        });
      }
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
              format: "docx",
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
    // Quick create and filter controls remain visible
    expect(screen.getByRole("region", { name: t("documents.home.quick_create.label") })).toBeInTheDocument();
    expect(typeFilterSelect()).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.editor")}`) })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.updated")}`) })).toBeInTheDocument();

    // No All / Folders / Documents pill row
    expect(screen.queryByRole("radiogroup", { name: /Lọc kết quả|Filter results/i })).toBeNull();

    // Folder cards section and Documents table section show match counts (1 folder card, 1 document row)
    const foldersSection = screen.getByRole("region", { name: new RegExp(`^${t("documents.home.sections.folders")} 1$`) });
    expect(within(foldersSection).getByRole("button", { name: /^Hợp đồng 2026/ })).toBeInTheDocument();
    expect(within(foldersSection).queryByText("Khác")).toBeNull();
    const docsSection = screen.getByRole("region", { name: new RegExp(`^${t("documents.home.sections.documents")} 1$`) });
    expect(within(docsSection).getByRole("table")).toBeInTheDocument();
    expect(within(docsSection).getByText("Hợp đồng lao động.docx")).toBeInTheDocument();
    // Folder hit is in the folder cards section, not in the table
    expect(within(within(docsSection).getByRole("table")).queryByText("Hợp đồng 2026")).toBeNull();

    // Search query params
    expect(searchUrls.length).toBeGreaterThanOrEqual(1);
    const params = queryOf(searchUrls.at(-1)!);
    expect(params.get("q")).toBe("hop dong");
    expect(params.get("match")).toBe("title");
    expect(params.get("kind")).toBeNull();

    // Subfolder match path is shown on the card and on the row, with screen-reader full path
    expect(within(foldersSection).getByTitle("Pháp chế")).toHaveTextContent("Pháp chế");
    expect(within(docsSection).getByTitle("Pháp chế › Hợp đồng 2026")).toHaveTextContent("Pháp chế › Hợp đồng 2026");
    expect(screen.getByText(t("documents.home.search.path", { path: "Pháp chế › Hợp đồng 2026" }))).toBeInTheDocument();
  });

  it("combines active filters (Loại, Người sửa, Cập nhật, Lưu trữ bởi) with the search query", async () => {
    const searchUrls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path === MEMBERS_URL) {
        return Promise.resolve({
          members: [{ workspace_id: WS, user_id: "u2", role: "member", email: "dung@example.com", display_name: "Dũng" }],
        });
      }
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        searchUrls.push(path);
        const q = queryOf(path);
        const type = q.get("type");
        const updatedBy = q.get("updated_by");
        const docs = [
          summary({ id: "fo-1", kind: "folder", title: "Hợp đồng đối tác", updated_by: "u2", path: [] }),
          summary({ id: "doc-docx", kind: "file", title: "Hợp đồng mẫu.docx", format: "docx", updated_by: "u2", path: [] }),
          summary({ id: "doc-page", kind: "page", title: "Hợp đồng nháp", updated_by: "u1", path: [] }),
        ];
        return Promise.resolve({
          documents: docs.filter((d) => {
            if (updatedBy && d.updated_by !== updatedBy) return false;
            if (type === "docx") return d.kind === "folder" || d.format === "docx";
            if (type === "page") return d.kind === "page";
            return true;
          }),
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "hop dong" } });

    expect(await screen.findByText("Hợp đồng mẫu.docx")).toBeInTheDocument();
    expect(screen.getByText("Hợp đồng nháp")).toBeInTheDocument();
    expect(screen.getByText("Hợp đồng đối tác")).toBeInTheDocument();

    // Pick Loại: .docx -> sends type=docx with q=hop dong; folders stay at home root
    await pickTypeFilter("docx");
    await waitFor(() => {
      expect(searchUrls.some((u) => queryOf(u).get("q") === "hop dong" && queryOf(u).get("type") === "docx")).toBe(true);
    });
    expect(await screen.findByText("Hợp đồng mẫu.docx")).toBeInTheDocument();
    expect(screen.queryByText("Hợp đồng nháp")).toBeNull();

    // Pick Người sửa: Dũng -> sends updated_by=u2 with q=hop dong
    fireEvent.click(await screen.findByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.editor")}`) }));
    const dungOpt = within(await screen.findByRole("listbox")).getByText("Dũng");
    fireEvent.pointerDown(dungOpt);
    fireEvent.click(dungOpt);

    await waitFor(() => {
      expect(searchUrls.some((u) => queryOf(u).get("q") === "hop dong" && queryOf(u).get("updated_by") === "u2")).toBe(true);
    });
  });

  it("renders matches in list views (Gần đây and Có gắn sao) using their own table layout without folder cards or Mở tiếp cards, and narrows to the view's own scope", async () => {
    const searchUrls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(`${LIST_BASE}/recent`)) {
        return Promise.resolve({
          documents: [
            summary({
              id: "r1",
              kind: "file",
              title: "Báo cáo tuần.docx",
              format: "docx",
              last_activity: { kind: "edited", at: "2026-10-26T03:00:00Z" },
            }),
            summary({
              id: "r2",
              kind: "page",
              title: "Ghi chú nội bộ",
              last_activity: { kind: "opened", at: "2026-10-25T03:00:00Z" },
            }),
          ],
          next_cursor: null,
        });
      }
      if (path.includes("/documents/favorites")) {
        return Promise.resolve({
          favorites: [{ document_id: "s1", workspace_id: WS, title: "Tài liệu gắn sao", kind: "page" }],
          documents: [summary({ id: "s1", title: "Tài liệu gắn sao", favorited_at: "2026-10-26T03:00:00Z" })],
          next_cursor: null,
        });
      }
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        searchUrls.push(path);
        return Promise.resolve({
          documents: [
            summary({
              id: "r1",
              kind: "file",
              title: "Báo cáo tuần.docx",
              format: "docx",
              path: [{ id: "fo-1", title: "Kinh doanh" }],
              last_activity: { kind: "edited", at: "2026-10-26T03:00:00Z" },
            }),
            summary({
              id: "s1",
              kind: "page",
              title: "Tài liệu gắn sao",
              path: [],
              favorited_at: "2026-10-26T03:00:00Z",
            }),
            summary({
              id: "unstarred-hit",
              kind: "page",
              title: "Tài liệu chưa gắn sao",
              path: [],
            }),
          ],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    const { unmount } = renderSearchView(createNav("view=recent"));
    expect((await screen.findAllByText("Báo cáo tuần.docx")).length).toBeGreaterThanOrEqual(1);
    // Mở tiếp cards show before search
    expect(screen.getByRole("region", { name: t("documents.recent.continue_title") })).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "bao cao" } });

    // Mở tiếp hides while searching, Recent table columns stay (including Lần mở gần nhất)
    await waitFor(() => expect(screen.queryByRole("region", { name: t("documents.recent.continue_title") })).toBeNull());
    expect(await screen.findByText("Báo cáo tuần.docx")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: t("documents.list.screen_column.activity") })).toBeInTheDocument();
    expect(screen.getByTitle("Kinh doanh")).toHaveTextContent("Kinh doanh");
    // Activity segment stays visible in toolbar on Recent
    expect(screen.getByRole("radiogroup", { name: t("documents.home.filters.activity_label") })).toBeInTheDocument();
    unmount();

    // Có gắn sao view: keeps Starred table with Ngày gắn sao column and only shows starred matches
    renderSearchView(createNav("view=starred"));
    expect(await screen.findByText("Tài liệu gắn sao")).toBeInTheDocument();
    const starredSearchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(starredSearchInput, { target: { value: "tai lieu" } });

    expect(await screen.findByText("Tài liệu gắn sao")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: t("documents.list.screen_column.starred") })).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu chưa gắn sao")).toBeNull();
  });

  it("pressing Escape or clicking clear X returns to the open folder without reload", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) {
        return Promise.resolve({
          documents: [
            {
              id: "fo-open",
              title: "Thư mục đang mở",
              kind: "folder",
              position: 0,
              children: [{ id: "sub-1", title: "Thư mục con A", kind: "folder", position: 0, children: [] }],
            },
          ],
        });
      }
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
          documents: [summary({ id: "hit-1", title: "Kết quả tìm kiếm", path: [{ id: "fo-open", title: "Thư mục đang mở" }] })],
          next_cursor: null,
        });
      }
      if (path.startsWith(LIST_BASE) && queryOf(path).get("parent_id") === "fo-open") {
        return Promise.resolve({
          documents: [summary({ id: "in-folder", title: "Tài liệu trong thư mục", parent_id: "fo-open" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    const nav = createNav("folder=fo-open");
    renderSearchView(nav);

    expect(await screen.findByText("Tài liệu trong thư mục")).toBeInTheDocument();
    expect(screen.getByText("Thư mục con A")).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "ket qua" } });

    expect(await screen.findByText("Kết quả tìm kiếm")).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu trong thư mục")).toBeNull();
    // Subfolder card that didn't match is hidden while searching
    expect(screen.queryByText("Thư mục con A")).toBeNull();

    const clearBtn = screen.getAllByRole("button", { name: t("documents.home.search.clear") })[0]!;
    expect(clearBtn.className).not.toContain("-translate-y-1/2");
    expect(clearBtn.className).toContain("inset-y-0");

    fireEvent.keyDown(searchInput, { key: "Escape" });

    expect(searchInput).toHaveValue("");
    expect(await screen.findByText("Tài liệu trong thư mục")).toBeInTheDocument();
    expect(screen.getByText("Thư mục con A")).toBeInTheDocument();
    expect(screen.queryByText("Kết quả tìm kiếm")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
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

  it("activating a matched folder card navigates to the folder URL and a matched document row navigates to the document URL", async () => {
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

    const docCell = (await screen.findByText("Tài liệu đích")).closest("button")!;
    fireEvent.click(docCell);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("doc-target");
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith(wsPaths.document("doc-target"));

    const folderBtn = screen.getByRole("button", { name: /^Thư mục đích/ });
    fireEvent.click(folderBtn);
    expect(nav.push).toHaveBeenCalledTimes(2);
    expect(nav.push).toHaveBeenLastCalledWith(wsPaths.documentsFolder("fo-target"));
  });

  it("renders the list's empty state with the query in the title and a clear search action when no results match, and the list's error state with retry on failure", async () => {
    let shouldFail = true;
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        if (shouldFail) return Promise.reject(new ApiError("boom", "internal", 500));
        return Promise.resolve({ documents: [], next_cursor: null });
      }
      return Promise.resolve({ documents: [summary({ id: "root-1", title: "Tài liệu ban đầu" })], next_cursor: null });
    });

    renderSearchView();
    expect(await screen.findByText("Tài liệu ban đầu")).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "khong co" } });

    // List error state with retry
    const alertState = await screen.findByRole("alert");
    expect(within(alertState).getByText(t("documents.library.error_title"))).toBeInTheDocument();

    shouldFail = false;
    fireEvent.click(within(alertState).getByRole("button", { name: t("documents.library.retry") }));

    // Empty state with the query in the title and a clear search button that returns focus to the search box (KLV-4)
    const expectedTitle = t("documents.home.search.no_results_title", { query: "khong co" });
    expect(await screen.findByText(expectedTitle)).toBeInTheDocument();
    const statusRegion = screen.getByRole("status");
    const clearAction = within(statusRegion).getByRole("button", { name: t("documents.home.search.clear") });
    clearAction.focus();
    expect(document.activeElement).toBe(clearAction);
    fireEvent.click(clearAction);

    expect(searchInput).toHaveValue("");
    expect(document.activeElement).toBe(searchInput);
    expect(await screen.findByText("Tài liệu ban đầu")).toBeInTheDocument();
  });

  it("truncates long ancestor paths from the left on matched rows and cards while keeping the full path in title and sr-only text", async () => {
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
    const pathEl = screen.getByTitle(fullPath);
    expect(pathEl.textContent).toBe("… › Năm 2026 › Quý 4");
    expect(titleEl.compareDocumentPosition(pathEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(t("documents.home.search.path", { path: fullPath }))).toBeInTheDocument();

    const longAncestorEl = screen.getByTitle(longAncestor);
    expect(longAncestorEl.textContent?.startsWith("…")).toBe(true);
    expect(longAncestorEl.textContent!.length).toBeLessThan(longAncestor.length);
    expect(screen.getByText(t("documents.home.search.path", { path: longAncestor }))).toBeInTheDocument();

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
      expect(screen.getByText("Hợp đồng khung")).toBeInTheDocument();
      expect(screen.queryByLabelText(t("documents.library.loading"))).toBeNull();
      act(() => {
        vi.advanceTimersByTime(250);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText("Hợp đồng phụ lục")).toBeInTheDocument();
  });

  it("places the search box on the filter row (right end) on home, open folder, and list screens, not in the head row (UNI-2205)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path === "/api/v1/documents/fo-open") {
        return Promise.resolve({
          document: {
            id: "fo-open",
            workspace_id: WS,
            kind: "folder",
            title: "Dự án CCB",
            revision: "1",
            my_level: "manage",
            breadcrumbs: [{ id: "fo-open", title: "Dự án CCB" }],
          },
        });
      }
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        return Promise.resolve({
          documents: [summary({ id: "hit-invalid", title: "Tài liệu tìm từ thư mục lỗi" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    const { unmount } = render(
      wrap(
        <NavigationProvider value={createNav()}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <FeatureFlagsProvider service={new FeatureFlagService(new StaticProvider({ documents: { default: true } }))}>
              <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
            </FeatureFlagsProvider>
          </WorkspaceProvider>
        </NavigationProvider>,
      ),
    );

    const homeHeading = screen.getByRole("heading", { level: 1, name: t("documents.home.sidebar.home") });
    const homeHeadRow = homeHeading.parentElement!.parentElement!.parentElement!;
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    const homeSearchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    expect(homeSearchInput).toHaveAttribute("placeholder", t("documents.home.search.placeholder"));
    const homeSearchBox = homeSearchInput.closest<HTMLElement>('[data-slot="documents-search-box"]')!;
    const homeSearchSlot = homeSearchInput.closest<HTMLElement>('[data-slot="documents-search-slot"]')!;
    expect(homeHeadRow.contains(homeSearchSlot)).toBe(false);

    const filterZone = document.querySelector<HTMLElement>('[data-slot="documents-filter-zone"]')!;
    const filterRow = filterZone.parentElement!;
    expect(filterRow.contains(homeSearchSlot)).toBe(true);
    expect(filterZone.contains(homeSearchSlot)).toBe(false);
    expect(filterRow.className).toContain("@container");
    expect(filterRow.className).toContain("flex-wrap");
    expect(filterRow.className).toContain("@min-[48rem]:flex-nowrap");
    expect(filterZone.className).toContain("flex-1");
    expect(filterZone.className).toContain("flex-wrap");
    expect(homeSearchSlot.className).toContain("basis-full");
    expect(homeSearchSlot.className).toContain("justify-end");
    expect(homeSearchSlot.className).toContain("@min-[48rem]:ml-auto");
    expect(homeSearchSlot.className).toContain("@min-[48rem]:w-80");
    expect(homeSearchSlot.className).toContain("@min-[48rem]:shrink-0");
    expect(homeSearchSlot.className).toContain("@min-[48rem]:basis-auto");
    expect(homeSearchBox.className).toContain("@min-[24rem]:w-56");
    expect(homeSearchBox.className).toContain("@min-[24rem]:focus-within:w-80");
    expect(homeSearchBox.className).toContain("@min-[48rem]:w-56");
    expect(homeSearchBox.className).toContain("@min-[48rem]:focus-within:w-full");
    unmount();

    // Open folder: search box is on the filter row with the neutral placeholder (KLR-9), not in breadcrumb head row
    const { unmount: unmountFolder } = render(
      wrap(
        <NavigationProvider value={createNav("folder=fo-open")}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <FeatureFlagsProvider service={new FeatureFlagService(new StaticProvider({ documents: { default: true } }))}>
              <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
            </FeatureFlagsProvider>
          </WorkspaceProvider>
        </NavigationProvider>,
      ),
    );
    const folderHeading = await screen.findByRole("heading", { level: 1, name: "Dự án CCB" });
    const crumb = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(crumb).toContainElement(folderHeading);
    const folderHeadRow = crumb.parentElement!.parentElement!;
    const folderSearchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    expect(folderSearchInput).toHaveAttribute("placeholder", t("documents.home.search.placeholder"));
    expect(folderHeadRow.contains(folderSearchInput)).toBe(false);
    const folderFilterZone = document.querySelector<HTMLElement>('[data-slot="documents-filter-zone"]')!;
    expect(folderFilterZone.contains(folderSearchInput)).toBe(false);
    expect(folderFilterZone.parentElement!.contains(folderSearchInput)).toBe(true);
    unmountFolder();

    // List screen (Recent): search box is on the filter row, not in DocumentsScreenHead
    const { unmount: unmountList } = render(
      wrap(
        <NavigationProvider value={createNav("view=recent")}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <FeatureFlagsProvider service={new FeatureFlagService(new StaticProvider({ documents: { default: true } }))}>
              <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
            </FeatureFlagsProvider>
          </WorkspaceProvider>
        </NavigationProvider>,
      ),
    );
    const recentHeading = await screen.findByRole("heading", { level: 1, name: t("documents.home.views.recent") });
    const recentHeadRow = recentHeading.parentElement!.parentElement!;
    const recentSearchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    expect(recentHeadRow.contains(recentSearchInput)).toBe(false);
    const recentFilterZone = document.querySelector<HTMLElement>('[data-slot="documents-filter-zone"]')!;
    expect(recentFilterZone.contains(recentSearchInput)).toBe(false);
    expect(recentFilterZone.parentElement!.contains(recentSearchInput)).toBe(true);

    // Shelved screen (Lưu trữ): search box is inside ShelvedToolbar (LibraryToolbar), not in DocumentsScreenHead
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("documents.home.sidebar.shelved")) })[0]!);
    const shelvedHeading = await screen.findByRole("heading", { level: 1, name: t("documents.shelved_list.title") });
    const shelvedHeadRow = shelvedHeading.parentElement!.parentElement!;
    const shelvedSearchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    expect(shelvedHeadRow.contains(shelvedSearchInput)).toBe(false);
    const shelvedFilterZone = document.querySelector<HTMLElement>('[data-slot="documents-filter-zone"]')!;
    expect(shelvedFilterZone.contains(shelvedSearchInput)).toBe(false);
    expect(shelvedFilterZone.parentElement!.contains(shelvedSearchInput)).toBe(true);
    unmountList();

    // Folder-invalid state (?folder=missing): search box is rendered above the error state and keeps its DOM node + focus when typing
    render(
      wrap(
        <NavigationProvider value={createNav("folder=missing")}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <FeatureFlagsProvider service={new FeatureFlagService(new StaticProvider({ documents: { default: true } }))}>
              <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
            </FeatureFlagsProvider>
          </WorkspaceProvider>
        </NavigationProvider>,
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.home.folder_invalid.title"));
    const invalidSearchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    const invalidSearchSlot = invalidSearchInput.closest<HTMLElement>('[data-slot="documents-search-slot"]')!;
    invalidSearchInput.focus();
    expect(document.activeElement).toBe(invalidSearchInput);

    fireEvent.change(invalidSearchInput, { target: { value: "h" } });
    expect(screen.getByRole("searchbox", { name: t("documents.home.search.label") })).toBe(invalidSearchInput);
    expect(invalidSearchInput.closest('[data-slot="documents-search-slot"]')).toBe(invalidSearchSlot);
    expect(document.activeElement).toBe(invalidSearchInput);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByText("Tài liệu tìm từ thư mục lỗi")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.search.clear") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.home.folder_invalid.title"));
    expect(screen.getByRole("searchbox", { name: t("documents.home.search.label") })).toBe(invalidSearchInput);
  });

  it("widens the search box on focus and while non-empty, keeps filter controls and Quick create visible while active, and keeps focus across the active toggle (UNI-2205)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        return Promise.resolve({
          documents: [summary({ id: "hit-1", title: "Hợp đồng tìm thấy" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [summary({ id: "doc-1", title: "Tài liệu ban đầu" })], next_cursor: null });
    });

    renderSearchView();
    expect(await screen.findByText("Tài liệu ban đầu")).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    const searchBox = searchInput.closest<HTMLElement>('[data-slot="documents-search-box"]')!;
    const searchSlot = searchInput.closest<HTMLElement>('[data-slot="documents-search-slot"]')!;

    expect(screen.getByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.type")}`) })).toBeInTheDocument();
    const filterZone = document.querySelector<HTMLElement>('[data-slot="documents-filter-zone"]')!;
    const filterRow = filterZone.parentElement!;
    expect(filterRow.contains(searchSlot)).toBe(true);
    expect(filterZone.contains(searchSlot)).toBe(false);
    expect(screen.getByRole("region", { name: t("documents.home.quick_create.label") })).toBeInTheDocument();

    expect(searchSlot).toHaveAttribute("data-expanded", "false");
    expect(searchBox).toHaveAttribute("data-expanded", "false");

    // Focus input and type first character -> search becomes active, same input & box elements stay mounted and focused,
    // AND filter zone and DocumentsHomeNote (Quick create) STAY visible!
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    fireEvent.change(searchInput, { target: { value: "h" } });
    const afterFirstCharInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    expect(afterFirstCharInput).toBe(searchInput);
    expect(afterFirstCharInput.parentElement).toBe(searchBox);
    expect(searchBox.parentElement).toBe(searchSlot);
    expect(document.activeElement).toBe(searchInput);
    expect(searchSlot).toHaveAttribute("data-expanded", "true");
    expect(searchBox).toHaveAttribute("data-expanded", "true");
    expect(searchInput.className).toContain("pr-8");
    expect(filterZone.isConnected).toBe(true);
    expect(screen.getByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.type")}`) })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("documents.home.quick_create.label") })).toBeInTheDocument();

    expect(await screen.findByText("Hợp đồng tìm thấy")).toBeInTheDocument();
    expect(document.activeElement).toBe(searchInput);

    // Blurring while query is non-empty keeps the expanded state via data-expanded="true"
    searchInput.blur();
    expect(searchSlot).toHaveAttribute("data-expanded", "true");
    expect(searchBox).toHaveAttribute("data-expanded", "true");

    // Clearing via clear X button returns to rest state, restores initial items, and returns focus to the input (KLV-4)
    const clearBtn = screen.getByRole("button", { name: t("documents.home.search.clear") });
    fireEvent.click(clearBtn);
    expect(searchInput).toHaveValue("");
    expect(document.activeElement).toBe(searchInput);
    expect(searchSlot).toHaveAttribute("data-expanded", "false");
    expect(searchBox).toHaveAttribute("data-expanded", "false");
    expect(await screen.findByText("Tài liệu ban đầu")).toBeInTheDocument();
  });

  it("keeps the same input focused on Lưu trữ while showing only shelved matches (KLR-2 / KLV-1), and never shows search on Thùng rác", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        return Promise.resolve({
          documents: [
            summary({
              id: "hit-shelved",
              title: "Kết quả tìm kiếm Lưu trữ",
              shelved_at: "2026-10-10T03:00:00Z",
              shelved_by: "u1",
            }),
            summary({
              id: "hit-unshelved",
              title: "Tài liệu chưa lưu trữ",
              shelved_at: null,
            }),
          ],
          next_cursor: null,
        });
      }
      if (path.startsWith(LIST_BASE) && queryOf(path).get("shelved") === "true") {
        return Promise.resolve({
          documents: [summary({ id: "sh-1", title: "Hồ sơ lưu trữ ban đầu", shelved_at: "2026-10-10T03:00:00Z", shelved_by: "u1" })],
          next_cursor: null,
        });
      }
      if (path.startsWith(LIST_BASE) && queryOf(path).get("archived") === "1") {
        return Promise.resolve({
          documents: [summary({ id: "tr-1", title: "Tài liệu trong thùng rác", archived_at: "2026-10-12T03:00:00Z" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView(createNav("view=shelved"));
    expect(await screen.findByText("Hồ sơ lưu trữ ban đầu")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.type")}`) })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t("documents.shelved_list.filter_by_label") })).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    searchInput.focus();
    fireEvent.change(searchInput, { target: { value: "k" } });

    // Same input element stays mounted and focused; only the shelved hit renders, never the un-shelved hit (KLR-2)
    expect(screen.getByRole("searchbox", { name: t("documents.home.search.label") })).toBe(searchInput);
    expect(document.activeElement).toBe(searchInput);
    expect(screen.getByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.type")}`) })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t("documents.shelved_list.filter_by_label") })).toBeInTheDocument();
    expect(await screen.findByText("Kết quả tìm kiếm Lưu trữ")).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu chưa lưu trữ")).toBeNull();
    expect(screen.queryByText("Hồ sơ lưu trữ ban đầu")).toBeNull();
    expect(screen.getByRole("columnheader", { name: t("documents.list.screen_column.shelved") })).toBeInTheDocument();

    // Clear query -> initial shelved row returns
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.search.clear") }));
    expect(await screen.findByText("Hồ sơ lưu trữ ban đầu")).toBeInTheDocument();

    // Type query again, then switch to Thùng rác -> Trash renders its own table, never search results
    fireEvent.change(searchInput, { target: { value: "k" } });
    expect(await screen.findByText("Kết quả tìm kiếm Lưu trữ")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("documents.home.sidebar.trash")) })[0]!);
    expect(await screen.findByRole("heading", { level: 1, name: t("documents.trash.title") })).toBeInTheDocument();
    expect(await screen.findByText("Tài liệu trong thùng rác")).toBeInTheDocument();
    expect(screen.queryByText("Kết quả tìm kiếm Lưu trữ")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("filters loaded source rows client-side by accent-folded title on Ở nơi khác (view=sources) (KLR-1)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(`${LIST_BASE}/sources`)) {
        return Promise.resolve({
          items: [
            {
              id: "src-1",
              source: "chat",
              parent: { kind: "chat_channel", id: "ch-1", title: "Kênh Chung" },
              name: "Báo cáo Đánh giá Quý 4.xlsx",
              mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              extension: "xlsx",
              size_bytes: 2048,
              updated_at: "2026-10-20T03:00:00Z",
              owner: { id: "u1", kind: "human", name: "An" },
              can_open_in_app: false,
              can_save: true,
            },
            {
              id: "src-2",
              source: "task",
              parent: { kind: "task", id: "tk-1", title: "Việc A" },
              name: "Tài liệu thiết kế.pdf",
              mime_type: "application/pdf",
              extension: "pdf",
              size_bytes: 4096,
              updated_at: "2026-10-21T03:00:00Z",
              owner: { id: "u1", kind: "human", name: "An" },
              can_open_in_app: false,
              can_save: true,
            },
          ],
          next_cursor: null,
        });
      }
      // Even when document search returns 0 document hits, sources view matches loaded source rows
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView(createNav("view=sources"));
    expect(await screen.findByText("Báo cáo Đánh giá Quý 4.xlsx")).toBeInTheDocument();
    expect(screen.getByText("Tài liệu thiết kế.pdf")).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "danh gia" } });

    expect(await screen.findByText("Báo cáo Đánh giá Quý 4.xlsx")).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu thiết kế.pdf")).toBeNull();
    expect(screen.queryByText(t("documents.home.search.no_results_title", { query: "danh gia" }))).toBeNull();
  });

  it("shows search hits that are not in the loaded library page on Recent, Shared with me, and Shared by me (KLR-3)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(`${LIST_BASE}/recent`)) {
        return Promise.resolve({
          documents: [summary({ id: "r-page1", title: "Tài liệu trang 1", last_activity: { kind: "opened", at: "2026-10-26T03:00:00Z" } })],
          next_cursor: "cursor-page-2",
        });
      }
      if (path.startsWith(`${LIST_BASE}/shared-with-me`)) {
        return Promise.resolve({
          documents: [summary({ id: "sh-page1", title: "Chia sẻ trang 1", via: "share" })],
          next_cursor: "cursor-page-2",
        });
      }
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        const qParams = queryOf(path);
        if (qParams.get("shared_by_me") === "true") {
          return Promise.resolve({
            documents: [
              summary({
                id: "sbm-page2",
                title: "Chia sẻ bởi tôi trang 2",
                is_owner: true,
                visibility: "workspace",
                share_summary: { people: 2, workspaces: 0, links: 0, latest_at: "2026-10-25T03:00:00Z" },
              }),
            ],
            next_cursor: null,
          });
        }
        return Promise.resolve({
          documents: [
            summary({
              id: "unloaded-hit",
              title: "Hợp đồng ở trang 2 chưa tải",
              via: "share",
              updated_by: "u1",
            }),
          ],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    // 1. Recent: hit not in loaded page 1 still shows
    const { unmount: unmountRecent } = renderSearchView(createNav("view=recent"));
    expect((await screen.findAllByText("Tài liệu trang 1")).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByRole("searchbox", { name: t("documents.home.search.label") }), { target: { value: "trang 2" } });
    expect(await screen.findByText("Hợp đồng ở trang 2 chưa tải")).toBeInTheDocument();
    unmountRecent();

    // 2. Shared with me: hit with via="share" not in loaded page 1 still shows
    const { unmount: unmountShared } = renderSearchView(createNav("view=shared"));
    expect(await screen.findByText("Chia sẻ trang 1")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: t("documents.home.search.label") }), { target: { value: "trang 2" } });
    expect(await screen.findByText("Hợp đồng ở trang 2 chưa tải")).toBeInTheDocument();
    unmountShared();

    // 3. Shared by me: sends shared_by_me=true to server and shows page 2 hit
    renderSearchView(createNav("view=shared-by-me"));
    fireEvent.change(screen.getByRole("searchbox", { name: t("documents.home.search.label") }), { target: { value: "trang 2" } });
    expect(await screen.findByText("Chia sẻ bởi tôi trang 2")).toBeInTheDocument();
  });

  it("hides the Tài liệu section when only folders match a search query, shows the root path line on root hits, and renders the Tổ chức share-scope badge on search hits (KLR-4, KLR-7, KLR-10, KLV-3)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        const q = queryOf(path).get("q");
        if (q === "thu muc") {
          return Promise.resolve({
            documents: [summary({ id: "fo-only", kind: "folder", title: "Thư mục Pháp chế gốc", path: [] })],
            next_cursor: null,
          });
        }
        return Promise.resolve({
          documents: [
            summary({
              id: "root-org-doc",
              kind: "page",
              title: "Quy chế Tổ chức",
              path: [],
              shelved_at: "2026-10-10T03:00:00Z",
              share_scope: {
                home_workspace: false,
                users: 0,
                workspaces: 0,
                organization: true,
                public_link: false,
              },
            }),
          ],
          next_cursor: null,
        });
      }
      return Promise.resolve({ documents: [], next_cursor: null });
    });

    renderSearchView();
    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });

    // Folder-only match: Thư mục 1 shows with root path line "Tài liệu (gốc)", and Tài liệu 0 / no_results_title is hidden (KLR-4, KLR-7)
    fireEvent.change(searchInput, { target: { value: "thu muc" } });
    const foldersSection = await screen.findByRole("region", { name: new RegExp(`^${t("documents.home.sections.folders")} 1$`) });
    expect(within(foldersSection).getByText("Thư mục Pháp chế gốc")).toBeInTheDocument();
    const rootLabel = t("documents.home.search.path_root");
    expect(within(foldersSection).getByTitle(rootLabel)).toHaveTextContent(rootLabel);
    expect(screen.queryByRole("heading", { level: 2, name: new RegExp(`^${t("documents.home.sections.documents")}`) })).toBeNull();
    expect(screen.queryByText(t("documents.home.search.no_results_title", { query: "thu muc" }))).toBeNull();

    // Document root match with organization share_scope: shows root path line, "Tổ chức" badge, and title priority classes (KLR-7, KLR-10, KLV-3)
    fireEvent.change(searchInput, { target: { value: "quy che" } });
    const titleSpan = await screen.findByText("Quy chế Tổ chức");
    expect(titleSpan.className).toContain("min-w-[60%]");
    expect(titleSpan.parentElement?.className).toContain("flex-wrap");
    const row = titleSpan.closest("tr")!;
    expect(within(row).getByTitle(rootLabel)).toHaveTextContent(rootLabel);
    expect(within(row).getByText(t("documents.scope.organization"))).toBeInTheDocument();
  });
});

// ARCHIVE-01 (UNI-1845) U-6 + UI-AR8: a shelved search hit wears the "Đã lưu
// trữ" badge beside its name; the order is the server's.
describe("shelved search results (U-6)", () => {
  it("badges a shelved hit and leaves un-shelved hits unmarked in the library table", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        return Promise.resolve({
          documents: [
            summary({ id: "d1", kind: "file", title: "Hợp đồng cũ.docx", shelved_at: "2026-10-10T03:00:00Z", shelved_by: "u2", path: [] }),
            summary({ id: "d2", kind: "file", title: "Hợp đồng mới.docx", path: [] }),
          ],
          next_cursor: null,
        });
      }
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    renderSearchView();
    fireEvent.change(screen.getByRole("searchbox", { name: t("documents.home.search.label") }), { target: { value: "hop dong" } });

    const old = await screen.findByText("Hợp đồng cũ.docx");
    const row = old.closest("tr");
    expect(row && within(row as HTMLElement).getByText(t("documents.shelved_list.badge"))).toBeTruthy();
    const fresh = await screen.findByText("Hợp đồng mới.docx");
    const freshRow = fresh.closest("tr");
    expect(freshRow && within(freshRow as HTMLElement).queryByText(t("documents.shelved_list.badge"))).toBeNull();
  });

  it("opens LegacyFormatDialog instead of navigating when clicking a legacy search hit, and requests operation=view when the level is unknown", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE) && queryOf(path).get("q")) {
        const hitItem: Record<string, unknown> = summary({ id: "d-ppt", kind: "file", title: "Bài thuyết trình.ppt", format: "ppt", path: [] });
        delete hitItem.my_level;
        return Promise.resolve({
          documents: [hitItem],
          next_cursor: null,
        });
      }
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    const createSession = vi.fn().mockResolvedValue({
      launch_ticket: `ticket_${"a".repeat(32)}`,
      launch_url: `uniwork-office://open?ticket=ticket_${"a".repeat(32)}`,
      expires_at: "2026-10-26T00:00:00Z",
      document_id: "d-ppt",
      operation: "view",
      version: 1,
    });
    const desktopOpen: LibraryDesktopOpen = () => ({
      deploymentId: "dep-1",
      savedVersion: 1,
      createSession,
      launch: vi.fn().mockResolvedValue("launched"),
    });
    const { onOpen } = renderSearchView(createNav(), vi.fn(), desktopOpen);
    fireEvent.change(screen.getByRole("searchbox", { name: t("documents.home.search.label") }), { target: { value: "thuyet trinh" } });

    const hit = await screen.findByText("Bài thuyết trình.ppt");
    fireEvent.click(hit.closest("button")!);

    expect(onOpen).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: t("office.legacy.title") });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: t("office.desktop.action") }));
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith(
        "d-ppt",
        expect.objectContaining({ operation: "view", deployment_id: "dep-1" }),
      ),
    );
  });
});
