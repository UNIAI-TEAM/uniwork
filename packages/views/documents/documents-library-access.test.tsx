import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DocumentsLibraryList } from "./documents-library-list";
import { LibraryToolbar } from "./documents-library-toolbar";
import { type LibraryRowHandlers } from "./documents-library-row";
import { ACCESS_FILTERS, documentRow, matchesAccess, matchesChip, type AccessFilter, type DocumentSummaryRow, type LibraryRow, type TypeChip } from "./library-rows";
import { useState } from "react";

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
    expect(within(rowA).getByText("Quản lý")).toBeTruthy();
    expect(within(rowA).getByText("Hạn chế")).toBeTruthy();
    const rowB = document.querySelector('[data-library-row="b"]') as HTMLElement;
    expect(within(rowB).getByText("Xem")).toBeTruthy();
    expect(within(rowB).getByText("Cả workspace")).toBeTruthy();
    const rowC = document.querySelector('[data-library-row="c"]') as HTMLElement;
    expect(within(rowC).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("labels the comment level as its own word", () => {
    renderList([documentRow(item("a", "A.docx", { my_level: "comment" as DocumentSummaryRow["my_level"] }))]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    expect(within(row).getByText("Bình luận")).toBeTruthy();
  });

  it("keeps the two columns off the phone: hidden below lg", () => {
    renderList([documentRow(item("a", "A.docx", { my_level: "manage" }))]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const cell = within(row).getByText("Quản lý").closest("td")!;
    expect(cell.className).toContain("hidden");
    expect(cell.className).toContain("lg:table-cell");
  });
});

function Harness({ rows }: { rows: LibraryRow[] }) {
  const [chip, setChip] = useState<TypeChip>("all");
  const [access, setAccess] = useState<AccessFilter>("all");
  const shown = rows.filter((r) => matchesChip(r, chip) && matchesAccess(r, access));
  return (
    <>
      <LibraryToolbar
        scope="home"
        count={null}
        onScope={vi.fn()}
        chip={chip}
        onChip={setChip}
        access={access}
        onAccess={setAccess}
        groupBy="none"
        onGroupBy={vi.fn()}
      />
      <ul>
        {shown.map((r) => (
          <li key={r.id}>{r.type === "document" ? r.doc.title : r.id}</li>
        ))}
      </ul>
    </>
  );
}

describe("access filter in the toolbar", () => {
  const rows = [
    documentRow(item("a", "A.docx", { my_level: "manage" })),
    documentRow(item("b", "B.docx", { my_level: "edit" })),
    documentRow(item("c", "C.xlsx", { my_level: "view", visibility: "restricted" })),
    documentRow(item("d", "D.docx", { my_level: undefined })),
  ];

  it("is its own labelled group of pressed-state buttons, defaulting to All", () => {
    render(<Harness rows={rows} />);
    const group = screen.getByRole("group", { name: t("documents.home.access_filter_label") });
    expect(ACCESS_FILTERS).toEqual(["all", "manage", "edit", "restricted"]);
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Tất cả", "Tôi quản lý", "Tôi sửa được", "Hạn chế"]);
    expect(within(group).getByRole("button", { name: "Tất cả" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("filters by level and visibility, and ANDs with the type chip", () => {
    render(<Harness rows={rows} />);
    const group = screen.getByRole("group", { name: t("documents.home.access_filter_label") });
    fireEvent.click(within(group).getByRole("button", { name: "Tôi sửa được" }));
    expect(within(group).getByRole("button", { name: "Tôi sửa được" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["A.docx", "B.docx"]);
    fireEvent.click(within(group).getByRole("button", { name: "Tôi quản lý" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["A.docx"]);
    fireEvent.click(within(group).getByRole("button", { name: "Hạn chế" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["C.xlsx"]);
    fireEvent.click(within(group).getByRole("button", { name: "Tôi sửa được" }));
    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["A.docx", "B.docx"]);
    fireEvent.click(screen.getByRole("button", { name: "Sheets" }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
