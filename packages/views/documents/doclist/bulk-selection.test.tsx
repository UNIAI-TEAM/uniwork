import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentsLibraryList } from "../documents-library-list";
import type { LibraryRowHandlers } from "../documents-library-row";
import { documentRow, type DocumentSummaryRow } from "../library-rows";
import type { BulkPlan, DocListBulk } from "./bulk-actions";
import type { DocListScreen } from "./columns";

// UNI-2045 W9: the Select column, the header select-all, shift ranges, Esc and
// the bulk bar of each screen. The list stays presentational: it hands the bar
// action, the rows it may run on and the rows it skips to `bulk.run`.

const { t } = initI18n();

function doc(id: string, over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: `Tệp ${id}`,
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "manage",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

const noop = () => {};
const liveHandlers: LibraryRowHandlers = {
  onOpen: noop,
  onFolder: noop,
  onGoToSource: noop,
  onDownloadSource: noop,
  onSaveSource: noop,
  isStarred: () => false,
  personName: () => "An",
  onShare: noop,
  onMove: noop,
  onDownload: noop,
  onShelve: noop,
  onArchive: noop,
};
const shelvedHandlers: LibraryRowHandlers = { ...liveHandlers, onUnshelve: noop };
const trashHandlers: LibraryRowHandlers = { ...liveHandlers, onRestore: noop, onPurge: noop, onViewDetails: noop };

function bulkSpy() {
  // Share needs a dialog for several documents that does not exist yet: the host says it does not support it.
  const supports: DocListBulk["supports"] = (action) => action !== "share";
  return { supports, run: vi.fn<DocListBulk["run"]>() };
}

function list(rows: DocumentSummaryRow[], opts: { screen?: DocListScreen; handlers?: LibraryRowHandlers; bulk?: DocListBulk; selectionKey?: string } = {}) {
  return (
    <DocumentsLibraryList
      groups={[{ key: "all", rows: rows.map(documentRow) }]}
      loading={false}
      failure={null}
      hasMore={false}
      loadingMore={false}
      onLoadMore={noop}
      onRetry={noop}
      onClearFilters={noop}
      handlers={opts.handlers ?? liveHandlers}
      screen={opts.screen ?? "workspace"}
      selectable
      bulk={opts.bulk ?? bulkSpy()}
      selectionKey={opts.selectionKey ?? "k1"}
      empty={{ title: "empty", description: "empty" }}
    />
  );
}

const rowBox = (title: string) => screen.getByRole("checkbox", { name: t("documents.list.bulk.select_row", { title }) });
const allBox = () => screen.getByRole("checkbox", { name: t("documents.list.bulk.select_all") });
const bar = () => screen.getByRole("toolbar", { name: t("documents.list.bulk.toolbar") });
const barActions = () => within(bar()).getAllByRole("button").map((button) => button.textContent);

describe("bulk selection", () => {
  it("selects every loaded row from the header, and the header reads mixed on a partial selection", () => {
    render(list([doc("a"), doc("b"), doc("c")]));
    expect(screen.queryByRole("toolbar")).toBeNull();
    fireEvent.click(allBox());
    for (const id of ["a", "b", "c"]) expect(rowBox(`Tệp ${id}`)).toHaveAttribute("aria-checked", "true");
    expect(within(bar()).getByText(t("documents.list.bulk.selected", { count: 3 }))).toBeInTheDocument();
    fireEvent.click(rowBox("Tệp b"));
    expect(allBox()).toHaveAttribute("aria-checked", "mixed");
    expect(screen.getByText("Tệp a").closest("tr")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Tệp b").closest("tr")).toHaveAttribute("aria-selected", "false");
    fireEvent.click(allBox());
    expect(allBox()).toHaveAttribute("aria-checked", "true");
  });

  it("selects a range with shift-click", () => {
    render(list([doc("a"), doc("b"), doc("c"), doc("d")]));
    fireEvent.click(rowBox("Tệp a"));
    fireEvent.click(rowBox("Tệp c"), { shiftKey: true });
    expect(rowBox("Tệp b")).toHaveAttribute("aria-checked", "true");
    expect(rowBox("Tệp c")).toHaveAttribute("aria-checked", "true");
    expect(rowBox("Tệp d")).toHaveAttribute("aria-checked", "false");
    expect(within(bar()).getByText(t("documents.list.bulk.selected", { count: 3 }))).toBeInTheDocument();
  });

  it("clears on Esc and on Bỏ chọn", () => {
    render(list([doc("a"), doc("b")]));
    fireEvent.click(rowBox("Tệp a"));
    fireEvent.keyDown(rowBox("Tệp a"), { key: "Escape" });
    expect(screen.queryByRole("toolbar")).toBeNull();
    fireEvent.click(rowBox("Tệp b"));
    fireEvent.click(within(bar()).getByRole("button", { name: t("documents.list.bulk.clear") }));
    expect(rowBox("Tệp b")).toHaveAttribute("aria-checked", "false");
  });

  it("resets when the screen, folder or filter changes (a new selection key)", () => {
    const { rerender } = render(list([doc("a"), doc("b")], { selectionKey: "home" }));
    fireEvent.click(allBox());
    expect(bar()).toBeInTheDocument();
    rerender(list([doc("a"), doc("b")], { selectionKey: "recent", screen: "recent" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(rowBox("Tệp a")).toHaveAttribute("aria-checked", "false");
  });

  it("offers each screen's actions, in order, Share left out while the host cannot share several", () => {
    const rows = [doc("a"), doc("b")];
    const { unmount } = render(list(rows));
    fireEvent.click(allBox());
    expect(barActions()).toEqual([
      t("documents.list.bulk.action.move"),
      t("documents.list.bulk.action.download"),
      t("documents.list.bulk.action.shelve"),
      t("documents.list.bulk.action.trash"),
      t("documents.list.bulk.clear"),
    ]);
    unmount();

    const shelved = render(list(rows.map((row) => ({ ...row, shelved_at: "2026-10-20T01:00:00Z" })), { screen: "shelved", handlers: shelvedHandlers }));
    fireEvent.click(allBox());
    expect(barActions()).toEqual([
      t("documents.list.bulk.action.unshelve"),
      t("documents.list.bulk.action.download"),
      t("documents.list.bulk.action.trash"),
      t("documents.list.bulk.clear"),
    ]);
    shelved.unmount();

    render(list(rows.map((row) => ({ ...row, archived_at: "2026-10-20T01:00:00Z" })), { screen: "trash", handlers: trashHandlers }));
    fireEvent.click(allBox());
    expect(barActions()).toEqual([t("documents.list.bulk.action.restore"), t("documents.list.bulk.action.purge"), t("documents.list.bulk.clear")]);
  });

  it("hides what a viewer may not do and offers only the download", () => {
    render(list([doc("a", { my_level: "view" }), doc("b", { my_level: "view" })]));
    fireEvent.click(allBox());
    expect(barActions()).toEqual([t("documents.list.bulk.action.download"), t("documents.list.bulk.clear")]);
  });

  it("runs a mixed selection on the rows that allow it and lists the others as skipped, unsent", () => {
    const bulk = bulkSpy();
    render(list([doc("a"), doc("b", { my_level: "view" }), doc("c", { kind: "page", current_version: 0 })], { bulk }));
    fireEvent.click(allBox());
    fireEvent.click(within(bar()).getByRole("button", { name: t("documents.list.bulk.action.shelve") }));
    const plan = bulk.run.mock.calls[0]![0] as BulkPlan;
    expect(plan.action).toBe("shelve");
    expect(plan.docs.map((d) => d.id)).toEqual(["a", "c"]);
    expect(plan.skipped).toEqual([{ id: "b", code: "forbidden" }]);
    expect(plan.total).toBe(3);

    fireEvent.click(within(bar()).getByRole("button", { name: t("documents.list.bulk.action.download") }));
    const download = bulk.run.mock.calls[1]![0] as BulkPlan;
    expect(download.docs.map((d) => d.id)).toEqual(["a", "b"]);
    // A UniNote page is not a file: it cannot be downloaded, and says so.
    expect(download.skipped).toEqual([{ id: "c", code: "not_a_file" }]);
  });

  it("selects a folder only where an action applies to it, and a folder-only selection has no download", () => {
    render(list([doc("f1", { kind: "folder", current_version: 0 }), doc("f2", { kind: "folder", current_version: 0, my_level: "view" })]));
    // A viewer's folder has no bulk action on this screen: no checkbox.
    expect(screen.queryByRole("checkbox", { name: t("documents.list.bulk.select_row", { title: "Tệp f2" }) })).toBeNull();
    fireEvent.click(rowBox("Tệp f1"));
    expect(barActions()).toEqual([
      t("documents.list.bulk.action.move"),
      t("documents.list.bulk.action.shelve"),
      t("documents.list.bulk.action.trash"),
      t("documents.list.bulk.clear"),
    ]);
  });
});
