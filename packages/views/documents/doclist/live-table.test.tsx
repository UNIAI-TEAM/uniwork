import { render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DocumentsLibraryList } from "../documents-library-list";
import { type LibraryRowHandlers } from "../documents-library-row";
import { documentRow, type DocumentSummaryRow } from "../library-rows";
import { DEFAULT_LIBRARY_SORT } from "../library-sort";
import { docListRungs, docListSpec, type DocListScreen } from "./columns";

// UNI-2045 W1: the five live screens (workspace + folders, Recent, Starred,
// Shared with me, Shared by me) draw their table from the shared column spec:
// one column order, the shared cells and formats, the screen column right
// after Name, and the narrow ladder that hides Size, then the editor, then
// Access. jsdom cannot evaluate container queries, so the narrow cases read
// the rung each element names.

const { t } = initI18n();

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});

// Local wall clock: 2026-10-21 10:00. "Today" and "yesterday" read against it.
const NOW = new Date(2026, 9, 21, 10, 0);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const local = (month: number, day: number, hour: number, minute: number, year = 2026) => new Date(year, month - 1, day, hour, minute).toISOString();

const SCOPE = { users: 0, home_workspace: false, workspaces: 0, organization: false, public_link: false };

type Extra = Record<string, unknown>;

function doc(id: string, over: Partial<DocumentSummaryRow> & Extra = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: "Báo giá tháng 10.docx",
    visibility: "restricted",
    share_scope: SCOPE,
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "manage",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: local(10, 18, 9, 5),
    size_bytes: 2969,
    ...over,
  } as DocumentSummaryRow;
}

const handlers: LibraryRowHandlers = {
  onOpen: vi.fn(),
  onFolder: vi.fn(),
  onGoToSource: vi.fn(),
  onDownloadSource: vi.fn(),
  onSaveSource: vi.fn(),
  isStarred: () => false,
  personName: () => "An Trần",
};

function renderList(screenId: DocListScreen, rows: DocumentSummaryRow[] = [doc("a")], opts: { selectable?: boolean } = {}) {
  return render(
    <DocumentsLibraryList
      groups={[{ key: "all", rows: rows.map(documentRow) }]}
      loading={false}
      failure={null}
      filteredBy={null}
      hasMore={false}
      loadingMore={false}
      onLoadMore={vi.fn()}
      onRetry={vi.fn()}
      onClearFilters={vi.fn()}
      handlers={handlers}
      sort={{ value: DEFAULT_LIBRARY_SORT, onSort: vi.fn() }}
      screen={screenId}
      selectable={opts.selectable}
      empty={{ title: "empty", description: "empty" }}
    />,
  );
}

const headerTexts = () => screen.getAllByRole("columnheader", { hidden: true }).map((th) => th.textContent?.trim() ?? "");
const cell = (rowId: string, column: string) => document.querySelector(`[data-library-row="${rowId}"] > td[data-column="${column}"]`) as HTMLElement | null;

const RUNG = /^@min-\[(\d+)rem\]\/library:(.+)$/;
/** The rung (rem) at which `el` gets a class matching `utility`, or null. */
function rungOf(el: Element, utility: RegExp): number | null {
  for (const token of Array.from(el.classList)) {
    const match = RUNG.exec(token);
    if (match && utility.test(match[2]!)) return Number(match[1]);
  }
  return null;
}

const SCREEN_COLUMN: Record<Exclude<DocListScreen, "workspace" | "shelved" | "trash">, string> = {
  recent: "activity",
  starred: "starred",
  shared: "shared",
  "shared-by-me": "shared_with",
};

describe("live list columns (UNI-2045 W1)", () => {
  it("orders the workspace table Name · Access · Last edited by · Updated · Size · Actions, with no screen column", () => {
    renderList("workspace");
    expect(headerTexts()).toEqual(
      ["name", "access", "editor", "updated", "size", "actions"].map((id) => t(`documents.list.column.${id}`)),
    );
  });

  it.each(Object.entries(SCREEN_COLUMN))("puts the %s screen column right after Name, with its label", (screenId, column) => {
    renderList(screenId as DocListScreen);
    expect(headerTexts()).toEqual([
      t("documents.list.column.name"),
      t(`documents.list.screen_column.${column}`),
      ...["access", "editor", "updated", "size", "actions"].map((id) => t(`documents.list.column.${id}`)),
    ]);
    // The screen column sorts (W12): a button in its header, not the sorted one while the sort is Cập nhật.
    const th = screen.getAllByRole("columnheader", { hidden: true }).find((header) => header.textContent === t(`documents.list.screen_column.${column}`))!;
    expect(within(th).getByRole("button", { hidden: true })).toBeInTheDocument();
    expect(th).toHaveAttribute("aria-sort", "none");
    const cells = Array.from(document.querySelectorAll('[data-library-row="a"] > td')).map((td) => td.getAttribute("data-column"));
    expect(cells).toEqual(["name", column, "access", "editor", "updated", "size", "actions"]);
  });

  it("keeps the Select column out until a screen turns selection on", () => {
    renderList("recent");
    expect(document.querySelectorAll("colgroup col")).toHaveLength(7);
    expect(cell("a", "select")).toBeNull();
    document.body.replaceChildren();
    renderList("recent", [doc("a")], { selectable: true });
    expect(document.querySelectorAll("colgroup col")).toHaveLength(8);
    expect(headerTexts()[0]).toBe(t("documents.list.column.select"));
    expect(cell("a", "select")).not.toBeNull();
  });
});

describe("live list cells", () => {
  it("formats Updated and Size the shared way, in vi and in en", async () => {
    renderList("workspace", [doc("a"), doc("b", { updated_at: local(10, 20, 16, 30), size_bytes: 23 }), doc("c", { updated_at: local(10, 18, 9, 0, 2025) })]);
    expect(cell("a", "updated")).toHaveTextContent(/^18\/10$/);
    expect(cell("b", "updated")).toHaveTextContent(/^Hôm qua, 16:30$/);
    expect(cell("c", "updated")).toHaveTextContent(/^18\/10\/2025$/);
    expect(cell("a", "size")).toHaveTextContent(/^2,9 KB$/);
    expect(cell("b", "size")).toHaveTextContent(/^23 B$/);
    expect(cell("a", "size")).toHaveClass("text-right", "tabular-nums");
    document.body.replaceChildren();
    await setLocale("en");
    try {
      renderList("workspace", [doc("a"), doc("b", { updated_at: local(10, 20, 16, 30) })]);
      expect(cell("a", "updated")).toHaveTextContent(/^Oct 18$/);
      expect(cell("b", "updated")).toHaveTextContent(/^Yesterday, 16:30$/);
      expect(cell("a", "size")).toHaveTextContent(/^2\.9 KB$/);
    } finally {
      await setLocale("vi");
    }
  });

  it("writes a dash for the size of a UniNote", () => {
    renderList("workspace", [doc("p", { kind: "page", title: "Họp tuần", size_bytes: null })]);
    expect(cell("p", "size")).toHaveTextContent(/^—$/);
  });

  it("draws the access pill with the level line, and a public-link-only document as shared", () => {
    renderList("workspace", [
      doc("r", { my_level: "edit" }),
      doc("w", { visibility: "workspace", my_level: "view" }),
      doc("l", { share_scope: { ...SCOPE, public_link: true } }),
      doc("o", { is_owner: true }),
    ]);
    const pill = (id: string) => cell(id, "access")!.querySelector("[data-access-kind]")!;
    expect(pill("r")).toHaveAttribute("data-access-kind", "restricted");
    expect(cell("r", "access")).toHaveTextContent("Riêng tư");
    expect(cell("r", "access")).toHaveTextContent("Bạn: Sửa");
    expect(pill("w")).toHaveAttribute("data-access-kind", "workspace");
    expect(cell("w", "access")).toHaveTextContent("Bạn: Xem");
    expect(pill("l")).toHaveAttribute("data-access-kind", "shared");
    expect(cell("l", "access")).toHaveTextContent("Được chia sẻ");
    // is_owner (SV-5) read when the response carries it.
    expect(cell("o", "access")).toHaveTextContent("Chủ sở hữu");
  });

  it("names the editor from updated_by_user when the response carries it, else the member lookup", () => {
    renderList("workspace", [doc("a"), doc("b", { updated_by_user: { name: "Bình Lê", avatar_url: null } })]);
    expect(cell("a", "editor")).toHaveTextContent("An Trần");
    expect(cell("b", "editor")).toHaveTextContent("Bình Lê");
  });

  it("draws the name cell from the shared Name cell: type icon and title", () => {
    renderList("workspace");
    const name = cell("a", "name")!;
    expect(within(name).getByRole("img", { name: /word/i })).toBeInTheDocument();
    expect(within(name).getByText("Báo giá tháng 10.docx")).toHaveAttribute("title", "Báo giá tháng 10.docx");
  });
});

describe("live list screen column", () => {
  it.each(Object.entries(SCREEN_COLUMN))("writes a dash in the %s column while the response has no field for it", (screenId, column) => {
    renderList(screenId as DocListScreen);
    expect(cell("a", column)).toHaveTextContent(/^—$/);
  });

  it("shows the value of the agreed field when the response carries it", () => {
    renderList("recent", [doc("a", { last_activity: { kind: "opened", at: local(10, 21, 8, 15) } })]);
    expect(cell("a", "activity")).toHaveTextContent("08:15");
    document.body.replaceChildren();
    renderList("starred", [doc("a", { favorited_at: local(10, 20, 16, 30) })]);
    expect(cell("a", "starred")).toHaveTextContent("Hôm qua, 16:30");
    document.body.replaceChildren();
    renderList("shared", [doc("a", { shared: { by: "u9", by_kind: "human", by_name: "Chi Phạm", at: local(10, 18, 9, 0) } })]);
    expect(cell("a", "shared")).toHaveTextContent("Chi Phạm");
    expect(cell("a", "shared")).toHaveTextContent("18/10");
    document.body.replaceChildren();
    renderList("shared-by-me", [doc("a", { share_summary: { people: 3, workspaces: 1, links: 1, latest_at: local(10, 18, 9, 0) } })]);
    expect(cell("a", "shared_with")).toHaveTextContent("18/10");
  });
});

describe("live list narrow layout", () => {
  it.each(["workspace", "recent", "shared-by-me"] as const)("hides Size, then the editor, then Access on %s; Name and the screen column stay with the table", (screenId) => {
    renderList(screenId);
    const spec = docListSpec(screenId);
    const rungs = docListRungs(spec);
    const size = rungOf(cell("a", "size")!, /^table-cell$/)!;
    const editor = rungOf(cell("a", "editor")!, /^table-cell$/)!;
    const access = rungOf(cell("a", "access")!, /^table-cell$/)!;
    expect(size).toBeGreaterThan(editor);
    expect(editor).toBeGreaterThan(access);
    expect(access).toBeGreaterThan(rungs.table);
    expect(cell("a", "name")).not.toHaveClass("hidden");
    expect(cell("a", "actions")).not.toHaveClass("hidden");
    if (spec.screenColumn) {
      // Inside the table layout the screen column is on from its first width, with the header.
      expect(rungOf(cell("a", spec.screenColumn)!, /^table-cell$/)).toBe(rungs.table);
    }
    expect(rungOf(document.querySelector("thead")!, /^table-header-group$/)).toBe(rungs.table);
  });

  it("stacks the screen column's content under Name below the table rung", () => {
    renderList("starred", [doc("a", { favorited_at: local(10, 20, 16, 30) })]);
    const line = cell("a", "name")!.querySelector("[data-doclist-screen-line]") as HTMLElement;
    expect(line).toHaveTextContent("Hôm qua, 16:30");
    expect(rungOf(line, /^hidden$/)).toBe(docListRungs(docListSpec("starred")).table);
  });

  it("drops each part of the narrow line at the rung its column joins", () => {
    renderList("workspace");
    const rungs = docListRungs(docListSpec("workspace"));
    const name = cell("a", "name")!;
    const accessGroup = name.querySelector("[data-library-access-group]")!;
    const accessLine = name.querySelector("[data-library-access-line]")!;
    expect(rungOf(accessGroup, /^hidden$/)).toBe(rungs.access);
    // The line itself leaves once the last column it stands in for (the editor) joins.
    expect(rungOf(accessLine, /^hidden$/)).toBe(rungs.editor);
  });
});
