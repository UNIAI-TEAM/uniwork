import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
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
