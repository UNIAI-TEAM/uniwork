import { fireEvent, render, screen } from "@testing-library/react";
import { Archive, Clock, Folder, FolderLock, House, Share2, Star, Trash, Users } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { wrap } from "../test/api-mock";
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
      t("documents.home.my_folder.label"),
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
    expect(navLabels().slice(0, 8)).toEqual([
      t("documents.home.sidebar.home"),
      t("documents.home.my_folder.label"),
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
      ["documents.home.my_folder.label", "myFolders"],
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
    ["folder", Folder],
  ] as const)("maps %s to its board glyph", (key, Expected) => {
    expect(glyphOf(DOCUMENTS_NAV_ICONS[key])).toBe(glyphOf(Expected));
  });

  it("covers every entry of the map", () => {
    expect(Object.keys(DOCUMENTS_NAV_ICONS)).toHaveLength(10);
  });
});
