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
  it("lists the collections in board order, Thùng rác last, then the folders and the other modules", () => {
    renderSidebar();
    const labels = navLabels();
    const order = [
      t("documents.home.sidebar.home"),
      t("documents.home.sidebar.recent"),
      t("documents.home.sidebar.starred"),
      t("documents.home.sidebar.shared"),
      t("documents.home.sidebar.trash"),
    ];
    expect(labels.slice(0, order.length)).toEqual(order);
    expect(screen.getByText(t("documents.home.sidebar.folders"))).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree")).toBeInTheDocument();
    expect(screen.getByText(t("documents.home.sidebar.elsewhere"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
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

  it("keeps the same entries on the trash view, with no Lưu trữ entry", () => {
    renderSidebar({ view: { kind: "archived" } });
    expect(navLabels().slice(0, 5)).toEqual([
      t("documents.home.sidebar.home"),
      t("documents.home.sidebar.recent"),
      t("documents.home.sidebar.starred"),
      t("documents.home.sidebar.shared"),
      t("documents.home.sidebar.trash"),
    ]);
    expect(screen.queryByText("Lưu trữ")).toBeNull();
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
      ["home", "home"],
      ["recent", "recent"],
      ["starred", "starred"],
      ["shared", "shared"],
      ["trash", "trash"],
    ] as const;
    for (const [key, icon] of rows) {
      const row = screen.getByRole("button", { name: t(`documents.home.sidebar.${key}`) });
      expect(row.querySelector('[data-slot="icon-tile"]')).toBeNull();
      const svg = row.querySelector("svg");
      expect(svg).toHaveClass("size-4", "text-muted-foreground");
      expect(svg?.innerHTML).toBe(glyphOf(DOCUMENTS_NAV_ICONS[icon]));
    }
  });
});

describe("DOCUMENTS_NAV_ICONS", () => {
  // Rows the sidebar does not draw yet (myFolders, sharedByMe, archive,
  // folder) are pinned here so a wrong glyph cannot pass unseen.
  it.each([
    ["home", House],
    ["myFolders", FolderLock],
    ["recent", Clock],
    ["starred", Star],
    ["shared", Users],
    ["sharedByMe", Share2],
    ["archive", Archive],
    ["trash", Trash],
    ["folder", Folder],
  ] as const)("maps %s to its board glyph", (key, Expected) => {
    expect(glyphOf(DOCUMENTS_NAV_ICONS[key])).toBe(glyphOf(Expected));
  });
});
