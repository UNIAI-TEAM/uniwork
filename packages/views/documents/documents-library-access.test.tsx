import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DocumentsLibraryList } from "./documents-library-list";
import { LibraryToolbar } from "./documents-library-toolbar";
import { type LibraryRowHandlers } from "./documents-library-row";
import { ACCESS_FILTERS, documentRow, type AccessFilter, type DocumentSummaryRow, type LibraryRow } from "./library-rows";

// UNI-1642: the "My access" and "Visibility" columns and the access filter beside the type chips.

const { t } = initI18n();

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});

function item(id: string, title: string, over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: "ws1",
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
  isStarred: () => false,
  personName: () => "An",
};

function renderList(rows: LibraryRow[]) {
  return render(
    <DocumentsLibraryList
      groups={[{ key: "unfiled", title: "", rows }]}
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
    />,
  );
}

describe("library table access column", () => {
  it("shows the visibility and the viewer's level per row, with — where the row carries nothing", () => {
    renderList([
      documentRow(item("a", "A.docx", { my_level: "manage", visibility: "restricted" })),
      documentRow(item("b", "B.docx", { my_level: "view", visibility: "workspace" })),
      documentRow(item("c", "C.docx", { my_level: undefined, visibility: "weird" as DocumentSummaryRow["visibility"] })),
    ]);
    expect(screen.getByRole("columnheader", { name: t("documents.home.columns.access") })).toBeTruthy();
    const rowA = document.querySelector('[data-library-row="a"]') as HTMLElement;
    // The label shows twice: "Hạn chế" in the column (wide list) and on the secondary line (narrower list).
    expect(within(rowA).getAllByText("Hạn chế")).toHaveLength(2);
    expect(within(rowA).getByText("Bạn: Quản lý")).toBeTruthy();
    const rowB = document.querySelector('[data-library-row="b"]') as HTMLElement;
    expect(within(rowB).getByText("Bạn: Chỉ xem")).toBeTruthy();
    expect(within(rowB).getByText("Workspace")).toBeTruthy();
    const rowC = document.querySelector('[data-library-row="c"]') as HTMLElement;
    expect(within(rowC).getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("labels the comment level as its own word", () => {
    renderList([documentRow(item("a", "A.docx", { my_level: "comment" as DocumentSummaryRow["my_level"] }))]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    expect(within(row).getByText("Bạn: Bình luận")).toBeTruthy();
    expect(within(row).getByText("Bình luận")).toBeTruthy();
  });

  it("shows the column only when the list container is wide, and keeps the colgroup in step", () => {
    renderList([documentRow(item("a", "A.docx", { my_level: "manage" }))]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const cell = within(row).getByText("Bạn: Quản lý").closest("td")!;
    expect(cell.className).toContain("hidden");
    expect(cell.className).toContain("@min-[59rem]/library:table-cell");
    expect(document.querySelectorAll("colgroup col")).toHaveLength(6);
    expect(document.querySelectorAll("colgroup col.\\@min-\\[59rem\\]\\/library\\:table-column")).toHaveLength(1);
    expect(document.querySelectorAll("thead th.\\@min-\\[59rem\\]\\/library\\:table-cell")).toHaveLength(1);
    // The ladder (documents-library-ladder.test.tsx) holds the rest: no viewport breakpoint decides a column.
    expect(document.querySelector("th.lg\\:table-cell, .xl\\:table-cell, .xl\\:table-column, .xl\\:hidden, .md\\:table-cell")).toBeNull();
  });


  it("carries the level and the restricted lock on the row's secondary line while the main area is narrow", () => {
    renderList([
      documentRow(item("a", "A.docx", { my_level: "manage", visibility: "restricted" })),
      documentRow(item("b", "B.docx", { my_level: "view", visibility: "workspace" })),
      documentRow(item("c", "C.docx", { my_level: undefined, visibility: undefined })),
    ]);
    const line = (id: string) => {
      const row = document.querySelector(`[data-library-row="${id}"]`) as HTMLElement;
      return row.querySelector("[data-library-access-line]") as HTMLElement | null;
    };
    const lineA = line("a")!;
    expect(lineA.textContent).toContain("Quản lý");
    expect(lineA.textContent).toContain("Hạn chế");
    expect(lineA.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // A workspace row gets its level only, no lock and no "Workspace" noise.
    expect(line("b")!.textContent).toContain("Chỉ xem");
    expect(line("b")!.querySelector("svg")).toBeNull();
    expect(line("b")!.textContent).not.toContain("Workspace");
    // Unknown/missing level and visibility show nothing in the line.
    expect(line("c")?.textContent ?? "").not.toMatch(/Chỉ xem|Chỉnh sửa|Xem|Sửa|Quản lý|Bình luận|Hạn chế/);
  });
});

describe("access filter in the toolbar", () => {
  function renderToolbar(access: AccessFilter, onAccess = vi.fn()) {
    render(
      <LibraryToolbar
        variant="list"
        chip="all"
        onChip={vi.fn()}
        access={access}
        onAccess={onAccess}
        groupBy="none"
        onGroupBy={vi.fn()}
      />,
    );
    return onAccess;
  }

  it("is its own labelled group of pressed-state buttons, captioned so it is not a second type row", () => {
    renderToolbar("all");
    const group = screen.getByRole("group", { name: t("documents.home.access_filter_label") });
    expect(ACCESS_FILTERS).toEqual(["all", "manage", "edit", "restricted"]);
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Tất cả", "Tôi quản lý", "Tôi sửa được", "Hạn chế"]);
    expect(within(group).getByRole("button", { name: "Tất cả" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Tôi sửa được" }).getAttribute("aria-pressed")).toBe("false");
    // A visible caption sits before the group, and no divider is left to orphan when the groups wrap.
    expect(screen.getByText(t("documents.home.access_group_caption"))).toBeTruthy();
    expect(t("documents.home.access_group_caption")).toBe("Quyền");
    expect(document.querySelector("span.w-px")).toBeNull();
  });

  it("reports the pressed filter", () => {
    const onAccess = renderToolbar("all");
    fireEvent.click(screen.getByRole("button", { name: "Tôi quản lý" }));
    expect(onAccess).toHaveBeenCalledWith("manage");
  });
});
