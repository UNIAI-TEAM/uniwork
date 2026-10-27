import { fireEvent, render, screen } from "@testing-library/react";
import { Archive, Clock, Folder, FolderLock, House, Share2, ShieldCheck, Star, Trash, Users } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import enLocale from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { fakeNav, requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { DOCUMENTS_NAV_ICONS } from "./documents-nav-icons";
import { DocumentsSidebar, type DocumentsSidebarProps, type LibraryView } from "./documents-sidebar";

const { t } = initI18n();

function renderSidebar(over: Partial<DocumentsSidebarProps> = {}) {
  const onView = vi.fn<(view: LibraryView) => void>();
  const props: DocumentsSidebarProps = {
    wsId: "ws1",
    view: { kind: "home" },
    folderId: null,
    starredCount: null,
    sourcesAvailable: true,
    canCreate: true,
    onView,
    onFolder: vi.fn(),
    onNewFolder: vi.fn(),
    // The tree has its own tests; a stub keeps this file about the sub-nav.
    folderTree: <div data-testid="folder-tree" />,
    ...over,
  };
  render(wrap(<DocumentsSidebar {...props} />));
  return { onView };
}

const navLabels = () =>
  screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "")
    .filter((text) => text !== "");

describe("DocumentsSidebar sub-nav", () => {
  it("lists the collections in board order, Lưu trữ before Thùng rác, then the folders and the other modules", () => {
    renderSidebar();
    const labels = navLabels();
    const order = [
      t("documents.home.sidebar.home"),
      t("documents.home.sidebar.recent"),
      t("documents.home.sidebar.starred"),
      t("documents.home.sidebar.shared"),
      t("documents.home.sidebar.shared_by_me"),
      t("documents.home.sidebar.shelved"),
      t("documents.home.sidebar.trash"),
    ];
    expect(labels.slice(0, order.length)).toEqual(order);
    expect(screen.getByText(t("documents.home.sidebar.folders"))).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree")).toBeInTheDocument();
    expect(screen.getByText(t("documents.home.sidebar.elsewhere"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.home.origin.chat") })).toBeInTheDocument();
  });

  it("opens the shared-by-me view from the Tôi đã chia sẻ entry and marks it as the current page", () => {
    const { onView } = renderSidebar({ view: { kind: "sharedByMe" } });
    const row = screen.getByRole("button", { name: t("documents.home.sidebar.shared_by_me") });
    expect(row).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: t("documents.home.sidebar.home") })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: t("documents.home.sidebar.shared") })).not.toHaveAttribute("aria-current");
    fireEvent.click(row);
    expect(onView).toHaveBeenCalledWith({ kind: "sharedByMe" });
  });

  it("opens the trash view from the Thùng rác entry", () => {
    const { onView } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.sidebar.trash") }));
    expect(onView).toHaveBeenCalledWith({ kind: "archived" });
  });

  it("marks Thùng rác as the current page on the archived view, and nothing else", () => {
    renderSidebar({ view: { kind: "archived" } });
    expect(screen.getByRole("button", { name: t("documents.home.sidebar.trash") })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: t("documents.home.sidebar.home") })).not.toHaveAttribute("aria-current");
  });

  it("keeps the same entries on the trash view", () => {
    renderSidebar({ view: { kind: "archived" } });
    expect(navLabels().slice(0, 7)).toEqual([
      t("documents.home.sidebar.home"),
      t("documents.home.sidebar.recent"),
      t("documents.home.sidebar.starred"),
      t("documents.home.sidebar.shared"),
      t("documents.home.sidebar.shared_by_me"),
      t("documents.home.sidebar.shelved"),
      t("documents.home.sidebar.trash"),
    ]);
  });

  // ARCHIVE-01 (UNI-1845): the shelf is its own sub-nav entry (Main.dc / Archive.dc).
  it("opens the Lưu trữ view from its entry and marks it current there", () => {
    const { onView } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.sidebar.shelved") }));
    expect(onView).toHaveBeenCalledWith({ kind: "shelved" });
  });

  it("marks Lưu trữ as the current page on the shelved view, not Thùng rác", () => {
    renderSidebar({ view: { kind: "shelved" } });
    expect(screen.getByRole("button", { name: t("documents.home.sidebar.shelved") })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: t("documents.home.sidebar.trash") })).not.toHaveAttribute("aria-current");
  });

  // My Folder is a tree row; before the server has created it, one stand-in row under Thư mục creates it.
  it("shows a My Folder stand-in first under Thư mục only while the folder does not exist yet", () => {
    const onMyFolder = vi.fn();
    renderSidebar({ myFolderId: null, onMyFolder });
    const row = screen.getByRole("button", { name: t("documents.home.my_folder.label") });
    expect(row.nextElementSibling).toBe(screen.getByTestId("folder-tree"));
    expect(row.querySelector("svg")?.innerHTML).toBe(glyphOf(DOCUMENTS_NAV_ICONS.myFolders));
    fireEvent.click(row);
    expect(onMyFolder).toHaveBeenCalledTimes(1);
  });

  it("draws no My Folder row outside the tree once the folder exists", () => {
    renderSidebar({ myFolderId: "mf1", onMyFolder: vi.fn() });
    expect(screen.queryByRole("button", { name: t("documents.home.my_folder.label") })).toBeNull();
  });
});

// UNI-2009 addendum: the workspace access report is a sub-nav entry under Thùng rác,
// a real link (the report is its own page), not an item in a header overflow.
describe("DocumentsSidebar access report entry", () => {
  const REPORT = "/acme/doi/documents/access-report";
  const reportLink = () => screen.getByRole("link", { name: t("documents.accessReport.title") });

  function renderWithNav(over: Partial<DocumentsSidebarProps> = {}) {
    const adapter = fakeNav("/acme/doi/documents");
    render(
      wrapWithNav(
        <DocumentsSidebar
          wsId="ws1"
          view={{ kind: "home" }}
          folderId={null}
          starredCount={null}
          sourcesAvailable
          canCreate
          onView={vi.fn()}
          onFolder={vi.fn()}
          onNewFolder={vi.fn()}
          folderTree={<div data-testid="folder-tree" />}
          {...over}
        />,
        adapter,
      ),
    );
    return adapter;
  }

  it("draws a link to the workspace report directly under Thùng rác, before the folders", () => {
    renderWithNav({ accessReportHref: REPORT });
    const link = reportLink();
    expect(link).toHaveAttribute("href", REPORT);
    const trash = screen.getByRole("button", { name: t("documents.home.sidebar.trash") });
    expect(trash.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(screen.getByText(t("documents.home.sidebar.folders"))) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trash.nextElementSibling).toBe(link);
  });

  it("names the entry in both languages", () => {
    expect(viLocale.documents.accessReport.title).toBe("Báo cáo quyền truy cập");
    expect(enLocale.documents.accessReport.title).toBe("Access report");
  });

  it("opens the workspace report through the navigation adapter on a plain click", () => {
    const adapter = renderWithNav({ accessReportHref: REPORT, view: { kind: "archived" } });
    fireEvent.click(reportLink());
    expect(adapter.push).toHaveBeenCalledWith(REPORT);
  });

  it("is reachable by keyboard and carries the sibling row style with the report glyph", () => {
    renderWithNav({ accessReportHref: REPORT });
    const link = reportLink();
    expect(link).not.toHaveAttribute("tabindex", "-1");
    expect(link).toHaveClass("min-h-9", "pointer-coarse:min-h-11");
    expect(link.querySelector('[data-slot="icon-tile"]')).toBeNull();
    const svg = link.querySelector("svg");
    expect(svg).toHaveClass("size-4", "text-muted-foreground");
    expect(svg?.innerHTML).toBe(glyphOf(DOCUMENTS_NAV_ICONS.accessReport));
  });

  it("draws no entry when the host gives no report path", () => {
    renderSidebar();
    expect(screen.queryByRole("link", { name: t("documents.accessReport.title") })).toBeNull();
  });
});

/** What a lucide component renders, so a row's glyph can be compared by shape. */
function glyphOf(Icon: (typeof MODULE_ICONS)[keyof typeof MODULE_ICONS]) {
  return render(<Icon />).container.querySelector("svg")?.innerHTML;
}

describe("DocumentsSidebar icons", () => {
  it("draws each module source row with MODULE_ICONS on the module tile", () => {
    renderSidebar();
    const rows = [
      ["chat", "chat"],
      ["meeting", "meetings"],
      ["email", "email"],
      ["task", "tasks"],
    ] as const;
    for (const [source, module] of rows) {
      const row = screen.getByRole("button", { name: t(`documents.home.origin.${source}`) });
      const tile = row.querySelector('[data-slot="icon-tile"]');
      expect(tile).toHaveAttribute("data-tone", moduleTone(module));
      expect(tile).toHaveAttribute("data-variant", "solid");
      expect(tile?.querySelector("svg")?.innerHTML).toBe(glyphOf(MODULE_ICONS[module]));
    }
  });

  it("draws every other row in one style: a muted size-4 line glyph, no tile", () => {
    renderSidebar();
    const rows = [
      ["documents.home.sidebar.home", "home"],
      ["documents.home.sidebar.recent", "recent"],
      ["documents.home.sidebar.starred", "starred"],
      ["documents.home.sidebar.shared", "shared"],
      ["documents.home.sidebar.shared_by_me", "sharedByMe"],
      ["documents.home.sidebar.shelved", "shelved"],
      ["documents.home.sidebar.trash", "trash"],
    ] as const;
    for (const [key, icon] of rows) {
      const row = screen.getByRole("button", { name: t(key) });
      expect(row.querySelector('[data-slot="icon-tile"]')).toBeNull();
      const svg = row.querySelector("svg");
      expect(svg).toHaveClass("size-4", "text-muted-foreground");
      expect(svg?.innerHTML).toBe(glyphOf(DOCUMENTS_NAV_ICONS[icon]));
    }
  });

  it("aligns top-level folder rows, Drive rows, Drive account sub-rows, and module source rows on the same x=8/x=36 grid", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/config") {
        return Promise.resolve({
          flags: { documents: true, drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        });
      }
      if (path.startsWith("/api/v1/workspaces/ws1/documents/tree")) {
        return Promise.resolve({
          documents: [
            {
              id: "f-root",
              title: "Hợp đồng",
              kind: "folder",
              position: 0,
              children: [
                { id: "f-child", title: "Phụ lục", kind: "folder", parent_id: "f-root", position: 0, children: [] },
              ],
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const flagService = new FeatureFlagService(
      new StaticProvider({
        documents: { default: true },
        drive_connector: { default: true },
      }),
    );
    render(
      wrap(
        <FeatureFlagsProvider service={flagService}>
          <DocumentsSidebar
            wsId="ws1"
            view={{ kind: "home" }}
            folderId={null}
            starredCount={5}
            sourcesAvailable
            canCreate
            driveConnections={[
              { id: "conn1", google_email: "an@example.com", needs_reconnect: false, linked_file_count: 2 },
            ]}
            onView={vi.fn()}
            onFolder={vi.fn()}
            onNewFolder={vi.fn()}
          />
        </FeatureFlagsProvider>,
      ),
    );

    const driveRow = await screen.findByRole("button", { name: /^Google Drive/ });
    const driveAccountRow = screen.getByRole("button", { name: /Drive: an@example\.com/ });
    const rootFolderRow = await screen.findByRole("treeitem", { name: /Hợp đồng/ });
    const chatSourceRow = screen.getByRole("button", { name: t("documents.home.origin.chat") });

    // Reference grid: px-2 (8px) + size-5 (20px) + gap-2 (8px) -> label at x = 36px.
    expect(driveRow).toHaveClass("px-2", "gap-2");
    expect(driveRow.firstElementChild).toHaveClass("size-5");
    expect(chatSourceRow).toHaveClass("px-2", "gap-2");
    expect(chatSourceRow.firstElementChild).toHaveClass("size-5");

    // Top-level folder row shares the exact same icon/name x as the Google Drive row.
    expect(rootFolderRow).toHaveStyle({ paddingLeft: "8px" });
    expect(rootFolderRow).toHaveClass("px-2", "gap-2");
    expect(rootFolderRow.firstElementChild).toHaveClass("size-5");

    // Drive account sub-row label starts at x = 36px (pl-9) with right-aligned count (pr-2).
    expect(driveAccountRow).toHaveClass("pl-9", "pr-2");

    // Child folder indents by one 28px step (paddingLeft = 36px, icon sits under parent's name).
    fireEvent.click(
      screen.getByRole("button", { name: t("documents.tree.expand", { title: "Hợp đồng" }) }),
    );
    const childFolderRow = await screen.findByRole("treeitem", { name: /Phụ lục/ });
    expect(childFolderRow).toHaveStyle({ paddingLeft: "36px" });
    expect(
      Number.parseFloat(childFolderRow.style.paddingLeft) -
        Number.parseFloat(rootFolderRow.style.paddingLeft),
    ).toBe(28);
  });
});
describe("DOCUMENTS_NAV_ICONS", () => {
  // Rows the sidebar does not draw yet (myFolders, archive, folder) are pinned
  // here so a wrong glyph cannot pass unseen.
  it.each([
    ["home", House],
    ["myFolders", FolderLock],
    ["recent", Clock],
    ["starred", Star],
    ["shared", Users],
    ["sharedByMe", Share2],
    ["archive", Archive],
    ["shelved", Archive],
    ["trash", Trash],
    ["accessReport", ShieldCheck],
    ["folder", Folder],
  ] as const)("maps %s to its board glyph", (key, Expected) => {
    expect(glyphOf(DOCUMENTS_NAV_ICONS[key])).toBe(glyphOf(Expected));
  });

  it("covers every entry of the map", () => {
    expect(Object.keys(DOCUMENTS_NAV_ICONS)).toHaveLength(11);
  });
});
