import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";
import { DocumentsLibraryList } from "./documents-library-list";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { libraryLadder } from "./library-columns";
import { documentRow, type DocumentSummaryRow, type LibraryRow } from "./library-rows";

// Visual r1 fixes for the Documents home (UNI-1305): the phone row keeps its
// name, one count, no create copy for a viewer, the app command in the row menu, one drop hint.

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;

function file(id: string, title: string, over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: WS,
    kind: "file",
    title,
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "edit",
    created_by: "",
    created_by_kind: "human",
    updated_by: "",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

const handlers: LibraryRowHandlers = {
  onOpen: vi.fn(),
  onFolder: vi.fn(),
  onGoToSource: vi.fn(),
  onDownloadSource: vi.fn(),
  onSaveSource: vi.fn(),
  onToggleStar: vi.fn(),
  isStarred: () => false,
  personName: () => "An",
  desktopOpen: (doc) => ({ deploymentId: "dep-1", savedVersion: doc.current_version }),
};

function renderList(rows: LibraryRow[] = [documentRow(file("f1", "Báo giá tháng 10.docx"))], over: Partial<LibraryRowHandlers> = {}) {
  return render(
    <DocumentsLibraryList
      groups={[{ key: "unfiled", title: "", rows }]}
      loading={false}
      failure={null}
      filtered={false}
      hasMore={false}
      loadingMore={false}
      onLoadMore={vi.fn()}
      onRetry={vi.fn()}
      onClearFilters={vi.fn()}
      handlers={{ ...handlers, ...over }}
      empty={{ title: "empty", description: "empty" }}
    />,
  );
}

describe("phone row layout (finding 1)", () => {
  it("lets the name button take the row and moves the app command into the menu below md", () => {
    render(
      <table>
        <tbody>
          <LibraryRowView row={documentRow(file("f1", "Báo giá tháng 10.docx"))} handlers={handlers} archived={false} ladder={libraryLadder()} />
        </tbody>
      </table>,
    );
    const name = screen.getByText("Báo giá tháng 10.docx");
    // The name truncates inside a button that fills the cell and may shrink.
    expect(name).toHaveClass("truncate");
    const button = name.closest("button");
    expect(button).toHaveClass("w-full", "min-w-0");
    expect(button?.querySelector("span.min-w-0")).toHaveClass("flex-1");
    // The icon-only app button does not take width from the name until the actions column widens (container, not viewport).
    const quick = document.querySelector("[data-office-desktop-action]");
    expect(quick?.parentElement).toHaveClass("hidden", "@min-[54rem]/library:block");
  });

  it("spans the group header over the two phone columns, then one spanner per ladder rung", () => {
    renderList();
    const group = document.querySelector("[data-library-group]");
    expect(group).toHaveAttribute("colspan", "2");
    // Truy cập, Người sửa gần nhất, Cập nhật and Dung lượng each get their own spanner (Dung lượng's cell class carries text-right): DOM order, not rung order.
    const spanners = Array.from(group!.parentElement!.children).slice(1);
    expect(spanners.map((el) => el.getAttribute("colspan"))).toEqual(["1", "1", "1", "1"]);
    expect(spanners.map((el) => Array.from(el.classList).find((c) => c.startsWith("@min-"))?.split(":")[0])).toEqual([
      "@min-[53rem]/library",
      "@min-[40rem]/library",
      "@min-[28rem]/library",
      "@min-[28rem]/library",
    ]);
    // One header and the rows share one column template.
    expect(document.querySelectorAll("colgroup col")).toHaveLength(6);
  });
});

describe("row accessible names", () => {
  it("names the row button by its type mark and title, apart from the menu trigger", () => {
    renderList([documentRow(file("f1", "Báo giá tháng 10.docx")), documentRow(file("p1", "Kế hoạch Q4", { kind: "page" }))]);
    // The type mark is exposed (a docx is "Tài liệu Word"), so the title is a suffix, not the whole name.
    expect(screen.getByRole("button", { name: new RegExp(`^${t("documents.file_types.docx")} Báo giá tháng 10\\.docx`) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`^${t("documents.file_types.page")} Kế hoạch Q4`) })).toBeInTheDocument();
    // The menu trigger keeps its own descriptive name, one per row.
    expect(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Báo giá tháng 10.docx" }) })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Kế hoạch Q4/ })).toHaveLength(2);
  });
});

describe("phone row menu (finding 7)", () => {
  it("offers Open in UniWork Office, as on desktop", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Báo giá tháng 10.docx" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.home.row.open_app") })).toBeInTheDocument();
  });

  it("offers it to a viewer too (a read-only session) but not for a page", async () => {
    renderList([documentRow(file("f2", "Hợp đồng.pdf", { my_level: "view" }))]);
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng.pdf" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.home.row.open_app") })).toBeInTheDocument();
  });

  it("leaves it out of a page row", async () => {
    renderList([documentRow(file("p1", "Kế hoạch Q4", { kind: "page" }))]);
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    await screen.findByRole("menuitem", { name: t("documents.home.row.open_web") });
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.open_app") })).toBeNull();
  });
});

describe("page view (findings 4, 5, 8)", () => {
  function renderView() {
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    return render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
        </FeatureFlagsProvider>,
      ),
    );
  }

  function route(list: unknown[], tree: unknown[] = [], detail?: unknown) {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: tree });
      if (path.startsWith(`${LIST_BASE}/sources`)) return Promise.resolve({ items: [], next_cursor: null });
      if (path.startsWith("/api/v1/documents/") && (opts?.method ?? "GET") === "GET") return Promise.resolve(detail ? { document: detail } : {});
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: list, next_cursor: null });
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

  it("shows the same number beside Tài liệu as the table has rows; folders are cards (TRASH-A3)", async () => {
    route(
      [file("d1", "Báo giá.docx"), file("d2", "Biên bản.docx"), file("fo1", "Hợp đồng", { kind: "folder" })],
      [{ id: "fo1", title: "Hợp đồng", kind: "folder", position: 0, children: [] }],
    );
    renderView();
    await screen.findByText("Báo giá.docx");
    const section = screen.getByRole("region", { name: new RegExp(`^${t("documents.home.sections.documents")} [0-9]+$`) });
    const rows = within(within(section).getByRole("table")).getAllByRole("row").filter((row) => within(row).queryAllByRole("cell").length > 0);
    expect(rows).toHaveLength(2);
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(new RegExp(`${t("documents.home.sections.documents")} ${rows.length}$`));
  });

  it("shows the drop hint once on an empty workspace: in the empty state, not again below it", async () => {
    route([]);
    renderView();
    await screen.findByText(t("documents.home.empty.title"));
    expect(screen.queryByText(t("documents.home.drop_hint"))).toBeNull();
  });

  it("still shows the drop hint under a list that has rows", async () => {
    route([file("d1", "Báo giá.docx")]);
    renderView();
    await screen.findByText("Báo giá.docx");
    expect(screen.getByText(t("documents.home.drop_hint"))).toBeInTheDocument();
  });

  it("offers no create copy in a folder the user may only view, only the view-only line", async () => {
    route(
      [],
      [{ id: "fo1", title: "Thư mục chỉ xem", kind: "folder", position: 0, children: [] }],
      { id: "fo1", workspace_id: WS, kind: "folder", title: "Thư mục chỉ xem", revision: "3", updated_at: "2026-09-28T03:00:00Z", my_level: "view", breadcrumbs: [] },
    );
    renderView();
    fireEvent.click(await screen.findByRole("treeitem", { name: /Thư mục chỉ xem/ }));
    await screen.findByText(t("documents.home.empty.view_only"));
    await screen.findByRole("heading", { level: 1, name: /Thư mục chỉ xem/ });
    expect(screen.queryByText(t("documents.home.folder.info_banner", { folder: "Thư mục chỉ xem" }))).toBeNull();
    expect(screen.queryByRole("region", { name: t("documents.home.quick_create.label") })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeNull();
  });
});
