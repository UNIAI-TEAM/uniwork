import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentsLibraryList } from "./documents-library-list";
import { type LibraryRowHandlers } from "./documents-library-row";
import { documentRow, type DocumentSummaryRow } from "./library-rows";
import { DEFAULT_LIBRARY_SORT, type LibrarySort } from "./library-sort";

// UNI-2038 S2: the table headers sort. The list is presentational: it shows
// the sort it is given and says which column was clicked.

const { t } = initI18n();

function file(id: string): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: "Báo cáo tổng kết quý",
    visibility: "restricted",
    share_scope: { users: 0, home_workspace: false, workspaces: 0, organization: false, public_link: false },
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
  };
}

const handlers: LibraryRowHandlers = {
  onOpen: vi.fn(),
  onFolder: vi.fn(),
  onGoToSource: vi.fn(),
  onDownloadSource: vi.fn(),
  onSaveSource: vi.fn(),
  isStarred: () => false,
  personName: () => "An",
};

function renderList(sort: LibrarySort | null, onSort = vi.fn(), extra: { sharedByMe?: boolean } = {}) {
  render(
    <DocumentsLibraryList
      groups={[{ key: "all", title: "", rows: [documentRow(file("a"))] }]}
      loading={false}
      failure={null}
      filteredBy={null}
      hasMore={false}
      loadingMore={false}
      onLoadMore={vi.fn()}
      onRetry={vi.fn()}
      onClearFilters={vi.fn()}
      handlers={handlers}
      empty={{ title: "empty", description: "empty" }}
      sort={sort ? { value: sort, onSort } : undefined}
      {...extra}
    />,
  );
  return onSort;
}

const head = (key: string) => screen.getByRole("columnheader", { name: new RegExp(t(`documents.home.columns.${key}`)) });
const sortButton = (label: string) => screen.getByRole("button", { name: new RegExp(`^${t("documents.home.sort.column", { column: label })}`) });

describe("DocumentsLibraryList sortable headers", () => {
  it("marks the sorted column on its <th> and every other sortable one as none; Truy cập and Thao tác carry no aria-sort", () => {
    renderList(DEFAULT_LIBRARY_SORT);
    expect(head("updated")).toHaveAttribute("aria-sort", "descending");
    expect(head("name")).toHaveAttribute("aria-sort", "none");
    expect(head("editor")).toHaveAttribute("aria-sort", "none");
    expect(head("size")).toHaveAttribute("aria-sort", "none");
    expect(head("access")).not.toHaveAttribute("aria-sort");
    const actions = screen.getAllByRole("columnheader", { hidden: true }).at(-1)!;
    expect(actions).not.toHaveAttribute("aria-sort");
  });

  it("puts a type=button inside each sortable <th> and none in Truy cập or Thao tác", () => {
    renderList(DEFAULT_LIBRARY_SORT);
    for (const key of ["name", "editor", "updated", "size"]) {
      const button = within(head(key)).getByRole("button");
      expect(button).toHaveAttribute("type", "button");
    }
    expect(within(head("access")).queryByRole("button")).toBeNull();
    const actions = screen.getAllByRole("columnheader", { hidden: true }).at(-1)!;
    expect(within(actions).queryByRole("button")).toBeNull();
  });

  it("names the button 'Sắp xếp theo {cột}' and adds the direction on the sorted column", () => {
    renderList({ column: "name", order: "asc" });
    expect(within(head("name")).getByRole("button")).toHaveAccessibleName(
      `${t("documents.home.sort.column", { column: t("documents.home.columns.name") })}, ${t("documents.home.sort.ascending")}`,
    );
    expect(within(head("updated")).getByRole("button")).toHaveAccessibleName(
      t("documents.home.sort.column", { column: t("documents.home.columns.updated") }),
    );
  });

  it("shows one arrow, on the sorted column only: ArrowDown for desc, ArrowUp for asc, aria-hidden", () => {
    renderList({ column: "updated", order: "desc" });
    const arrows = document.querySelectorAll("thead svg");
    expect(arrows).toHaveLength(1);
    expect(head("updated").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(head("updated").querySelector("svg")).toHaveClass("lucide-arrow-down");
  });

  it("draws ArrowUp for an ascending column", () => {
    renderList({ column: "name", order: "asc" });
    expect(document.querySelectorAll("thead svg")).toHaveLength(1);
    expect(head("name").querySelector("svg")).toHaveClass("lucide-arrow-up");
  });

  it("reports the column that was clicked", () => {
    const onSort = renderList(DEFAULT_LIBRARY_SORT);
    fireEvent.click(sortButton(t("documents.home.columns.name")));
    expect(onSort).toHaveBeenCalledWith("name");
    fireEvent.click(sortButton(t("documents.home.columns.size")));
    expect(onSort).toHaveBeenLastCalledWith("size");
  });

  it("is reachable with Tab and fires on Enter and Space", async () => {
    const user = userEvent.setup();
    const onSort = renderList(DEFAULT_LIBRARY_SORT);
    const nameButton = sortButton(t("documents.home.columns.name"));
    await user.tab();
    // The first tab stop of the table is the Name header button (no row control precedes it).
    expect(nameButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSort).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onSort).toHaveBeenCalledTimes(2);
    expect(onSort).toHaveBeenLastCalledWith("name");
  });

  it("sorts the same way on Shared by me, whose Truy cập joins at the editor's rung", () => {
    renderList({ column: "editor", order: "asc" }, vi.fn(), { sharedByMe: true });
    expect(head("editor")).toHaveAttribute("aria-sort", "ascending");
    expect(within(head("access")).queryByRole("button")).toBeNull();
  });

  it("keeps plain headers without a button when the caller passes no sort (the Lưu trữ table)", () => {
    renderList(null);
    expect(screen.queryByRole("button", { name: new RegExp(t("documents.home.sort.column", { column: "" }).trim()) })).toBeNull();
    for (const th of screen.getAllByRole("columnheader", { hidden: true })) {
      expect(th).not.toHaveAttribute("aria-sort");
    }
  });
});
