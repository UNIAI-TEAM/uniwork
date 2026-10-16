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
      filtered={false}
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

describe("library table access columns", () => {
  it("shows the viewer's level and the visibility per row, with — where the row carries nothing", () => {
    renderList([
      documentRow(item("a", "A.docx", { my_level: "manage", visibility: "restricted" })),
      documentRow(item("b", "B.docx", { my_level: "view", visibility: "workspace" })),
      documentRow(item("c", "C.docx", { my_level: undefined, visibility: "weird" as DocumentSummaryRow["visibility"] })),
    ]);
    expect(screen.getByRole("columnheader", { name: t("documents.home.columns.my_access") })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: t("documents.home.columns.visibility") })).toBeTruthy();
    const rowA = document.querySelector('[data-library-row="a"]') as HTMLElement;
    // Each value shows twice: in its column (wide list) and in the secondary line (narrower list).
    expect(within(rowA).getAllByText("Quản lý")).toHaveLength(2);
    expect(within(rowA).getAllByText("Hạn chế")).toHaveLength(2);
    const rowB = document.querySelector('[data-library-row="b"]') as HTMLElement;
    expect(within(rowB).getAllByText("Chỉ xem")).toHaveLength(2);
    expect(within(rowB).getByText("Workspace")).toBeTruthy();
    const rowC = document.querySelector('[data-library-row="c"]') as HTMLElement;
    expect(within(rowC).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("labels the comment level as its own word", () => {
    renderList([documentRow(item("a", "A.docx", { my_level: "comment" as DocumentSummaryRow["my_level"] }))]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    expect(within(row).getAllByText("Bình luận")).toHaveLength(2);
  });

  it("shows the two columns only when the list container is wide, and keeps the colgroup in step", () => {
    renderList([documentRow(item("a", "A.docx", { my_level: "manage" }))]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const cell = within(row).getAllByText("Quản lý").map((el) => el.closest("td")).find((td) => td?.className.includes("@min-[68rem]/library:table-cell"))!;
    expect(cell.className).toContain("hidden");
    expect(document.querySelectorAll("colgroup col")).toHaveLength(8);
    expect(document.querySelectorAll("colgroup col.\\@min-\\[68rem\\]\\/library\\:table-column")).toHaveLength(2);
    expect(document.querySelectorAll("thead th.\\@min-\\[68rem\\]\\/library\\:table-cell")).toHaveLength(2);
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
        scope="home"
        count={null}
        onScope={vi.fn()}
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
