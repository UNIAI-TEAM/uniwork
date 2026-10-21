import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DocumentsLibraryList } from "./documents-library-list";
import { type LibraryRowHandlers } from "./documents-library-row";
import { documentRow, type DocumentSummaryRow, type LibraryRow } from "./library-rows";

// UNI-1642: the "My access" and "Visibility" columns (the access filter left the toolbar with UNI-2045 Q6).

const { t } = initI18n();

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});

const SCOPE_PRIVATE = { users: 0, home_workspace: false, workspaces: 0, organization: false, public_link: false };
const SCOPE_HOME = { ...SCOPE_PRIVATE, home_workspace: true };

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
      groups={[{ key: "all", rows }]}
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
  it("shows the access pill and the viewer's level per row, and Riêng tư without a level where the row carries nothing", () => {
    renderList([
      documentRow(item("a", "A.docx", { my_level: "manage", visibility: "restricted", share_scope: SCOPE_PRIVATE })),
      documentRow(item("b", "B.docx", { my_level: "view", visibility: "workspace", share_scope: SCOPE_HOME })),
      documentRow(item("c", "C.docx", { my_level: undefined, visibility: "weird" as DocumentSummaryRow["visibility"] })),
    ]);
    expect(screen.getByRole("columnheader", { name: t("documents.home.columns.access") })).toBeTruthy();
    const rowA = document.querySelector('[data-library-row="a"]') as HTMLElement;
    // The label shows twice: "Riêng tư" in the column (wide list) and on the secondary line (narrower list).
    expect(within(rowA).getAllByText("Riêng tư")).toHaveLength(2);
    expect(within(rowA).getByText("Bạn: Quản lý")).toBeTruthy();
    const rowB = document.querySelector('[data-library-row="b"]') as HTMLElement;
    // UNI-2045: the shared level words and pill (doclist/cells.tsx); an unknown visibility is never a wider scope.
    expect(within(rowB).getByText("Bạn: Xem")).toBeTruthy();
    expect(within(rowB).getByText("Workspace")).toBeTruthy();
    const accessC = document.querySelector('[data-library-row="c"] > td[data-column="access"]') as HTMLElement;
    expect(accessC.querySelector("[data-access-kind]")).toHaveAttribute("data-access-kind", "restricted");
    expect(accessC.textContent).not.toMatch(/Bạn:/);
  });

  it("labels the comment level as its own word", () => {
    renderList([documentRow(item("a", "A.docx", { my_level: "comment" as DocumentSummaryRow["my_level"] }))]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    // UNI-2045: the shared word is Bình luận, in the column and on the narrow line.
    expect(within(row).getByText("Bạn: Bình luận")).toBeTruthy();
    expect(within(row).getByText("Bình luận")).toBeTruthy();
  });

  it("shows the column only when the list container is wide, and keeps the colgroup in step", () => {
    renderList([documentRow(item("a", "A.docx", { my_level: "manage" }))]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const cell = within(row).getByText("Bạn: Quản lý").closest("td")!;
    expect(cell.className).toContain("hidden");
    // UNI-2045: Access joins at the shared ladder's access rung (34rem on the workspace screen).
    expect(cell.className).toContain("@min-[34rem]/library:table-cell");
    expect(document.querySelectorAll("colgroup col")).toHaveLength(6);
    expect(document.querySelectorAll("colgroup col.\\@min-\\[34rem\\]\\/library\\:table-column")).toHaveLength(1);
    expect(document.querySelectorAll("thead th.\\@min-\\[34rem\\]\\/library\\:table-cell")).toHaveLength(1);
    // The ladder (documents-library-ladder.test.tsx) holds the rest: no viewport breakpoint decides a column.
    expect(document.querySelector("th.lg\\:table-cell, .xl\\:table-cell, .xl\\:table-column, .xl\\:hidden, .md\\:table-cell")).toBeNull();
  });


  it("carries the level and the restricted lock on the row's secondary line while the main area is narrow", () => {
    renderList([
      documentRow(item("a", "A.docx", { my_level: "manage", visibility: "restricted", share_scope: SCOPE_PRIVATE })),
      documentRow(item("b", "B.docx", { my_level: "view", visibility: "workspace", share_scope: SCOPE_HOME })),
      documentRow(item("c", "C.docx", { my_level: undefined, visibility: undefined })),
    ]);
    const line = (id: string) => {
      const row = document.querySelector(`[data-library-row="${id}"]`) as HTMLElement;
      return row.querySelector("[data-library-access-line]") as HTMLElement | null;
    };
    const lineA = line("a")!;
    expect(lineA.textContent).toContain("Quản lý");
    expect(lineA.textContent).toContain("Riêng tư");
    expect(lineA.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // A workspace row gets its level only, no lock and no "Workspace" noise.
    expect(line("b")!.textContent).toContain("Xem");
    expect(line("b")!.querySelector("svg")).toBeNull();
    expect(line("b")!.textContent).not.toContain("Workspace");
    // Unknown/missing level and visibility show nothing in the line.
    expect(line("c")?.textContent ?? "").not.toMatch(/Chỉ xem|Chỉnh sửa|Xem|Sửa|Quản lý|Nhận xét|Riêng tư|Hạn chế/);
  });
});
