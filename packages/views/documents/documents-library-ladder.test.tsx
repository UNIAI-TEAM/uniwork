import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentsLibraryList } from "./documents-library-list";
import { type LibraryRowHandlers } from "./documents-library-row";
import { documentRow, type DocumentSummaryRow } from "./library-rows";

// RootFix w2: every optional library column is driven by the list's own container width
// (`@container/library`), in a ladder where Name keeps its room. jsdom cannot evaluate
// container queries, so the test reads the rendered classes and evaluates them itself.

initI18n();

const NAME_MIN = 130;
/** Below this container width nothing optional is left to drop: Name = width - border - actions. */
const FLOOR = 320;
/** The list's own max width (max-w-6xl = 72rem minus the px-6 gutters). */
const LIST_MAX = 1104;
const BORDER = 2;

function file(id: string, over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: "Báo cáo tổng kết quý",
    visibility: "restricted",
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

const handlers: LibraryRowHandlers = {
  onOpen: vi.fn(),
  onFolder: vi.fn(),
  onGoToSource: vi.fn(),
  onDownloadSource: vi.fn(),
  onSaveSource: vi.fn(),
  isStarred: () => false,
  personName: () => "An",
};

function renderList() {
  return render(
    <DocumentsLibraryList
      groups={[{ key: "unfiled", title: "Nhóm", rows: [documentRow(file("a"))] }]}
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

const RUNG = /^@min-\[(\d+(?:\.\d+)?)rem\]\/library:(.+)$/;

/** The container width at which `el` gets `utility` (e.g. table-cell), or null when it never does. */
function rungOf(el: Element, utility: RegExp): number | null {
  for (const token of Array.from(el.classList)) {
    const match = RUNG.exec(token);
    if (match && utility.test(match[2]!)) return Number(match[1]) * 16;
  }
  return null;
}

/** Whether the element is displayed at container width `c`: no `hidden`, or a rung at or below `c`. */
function shownAt(el: Element, c: number, display: RegExp): boolean {
  if (!el.classList.contains("hidden")) return true;
  const rung = rungOf(el, display);
  return rung !== null && rung <= c;
}

function colWidthAt(col: Element, c: number): number {
  let width = 0;
  const read = (token: string) => {
    const scale = /^w-(\d+)$/.exec(token);
    if (scale) return Number(scale[1]) * 4;
    const px = /^w-\[(\d+)px\]$/.exec(token);
    return px ? Number(px[1]) : 0;
  };
  for (const token of Array.from(col.classList)) width = read(token) || width;
  for (const token of Array.from(col.classList)) {
    const match = RUNG.exec(token);
    const sized = match ? read(match[2]!) : 0;
    if (match && sized && Number(match[1]) * 16 <= c) width = sized;
  }
  return width;
}

function parts() {
  const cols = Array.from(document.querySelectorAll("colgroup col"));
  const heads = Array.from(document.querySelectorAll("thead th"));
  const cells = Array.from(document.querySelectorAll('[data-library-row="a"] > td'));
  const spanners = Array.from(document.querySelectorAll("[data-library-group]")).flatMap((th) => {
    const row = th.parentElement!;
    return Array.from(row.children);
  });
  return { cols, heads, cells, spanners };
}

/** The visible-column count and Name's width at container width `c`, from the rendered classes. */
function layoutAt(c: number) {
  const { cols, heads, cells, spanners } = parts();
  const visible = cols.map((col) => shownAt(col, c, /^table-column$/));
  const headVisible = heads.map((th) => shownAt(th, c, /^table-cell$/));
  const cellVisible = cells.map((td) => shownAt(td, c, /^table-cell$/));
  const fixed = cols.reduce((sum, col, i) => (i > 0 && visible[i] ? sum + colWidthAt(col, c) : sum), 0);
  const spanned = spanners.reduce((sum, el) => (shownAt(el, c, /^table-cell$/) ? sum + Number(el.getAttribute("colspan") ?? 1) : sum), 0);
  return {
    visible,
    headVisible,
    cellVisible,
    count: visible.filter(Boolean).length,
    name: c - BORDER - fixed,
    spanned,
  };
}

const IDS = ["name", "access", "editor", "updated", "size", "actions"];

describe("column ladder", () => {
  afterEach(() => document.body.replaceChildren());

  it("names the container and drives no column by the viewport", () => {
    renderList();
    expect(document.querySelector("table")?.closest(".\\@container\\/library")).toBeTruthy();
    const { cols, heads, cells } = parts();
    for (const el of [...cols, ...heads, ...cells, document.querySelector("thead")!]) {
      const bad = Array.from(el.classList).filter((token) => /^(max-)?(sm|md|lg|xl|2xl):/.test(token) || /^@(?!min-\[)/.test(token));
      expect(bad, el.outerHTML.slice(0, 80)).toEqual([]);
    }
    // The app command shares the same ladder as the rest of the row.
    expect(document.querySelector("[data-library-row] .max-md\\:hidden")).toBeNull();
  });

  it("keeps header, colgroup and cells in step at every container width", () => {
    renderList();
    const { cols, heads, cells } = parts();
    expect(heads.length).toBe(cols.length);
    expect(cells.length).toBe(cols.length);
    const header = document.querySelector("thead")!;
    for (let c = FLOOR; c <= LIST_MAX; c += 1) {
      const at = layoutAt(c);
      // Below the first rung the header is hidden outright (Name + actions only).
      const headerShown = shownAt(header, c, /^table-header-group$/);
      expect(at.cellVisible, `cells at ${c}`).toEqual(at.visible);
      if (headerShown) expect(at.headVisible, `headers at ${c}`).toEqual(at.visible);
      // The group spanner covers exactly the columns on screen: a wider colSpan adds implicit columns.
      expect(at.spanned, `group spanner at ${c}`).toBe(at.count);
    }
  });

  it("gives Name room at every container width the list can reach", () => {
    renderList();
    for (let c = FLOOR; c <= LIST_MAX; c += 1) {
      const { name } = layoutAt(c);
      // The rungs hold Name above the 130px floor except in the narrowest
      // containers, where only Name and the 48px actions column exist.
      const min = c - BORDER - 48 < NAME_MIN ? c - BORDER - 48 : NAME_MIN;
      expect(name, `Name at ${c}`).toBeGreaterThanOrEqual(min);
    }
  });

  it("only adds columns as the container widens, in the documented order", () => {
    renderList();
    let previous = new Set<string>();
    const steps: string[] = [];
    for (let c = FLOOR; c <= LIST_MAX; c += 1) {
      const { visible } = layoutAt(c);
      const now = new Set(IDS.filter((_, i) => visible[i]));
      for (const id of previous) expect(now.has(id), `${id} disappears at ${c}`).toBe(true);
      const added = [...now].filter((id) => !previous.has(id));
      if (added.length > 0) steps.push(`${c}:${added.join("+")}`);
      previous = now;
    }
    expect(steps.slice(1)).toEqual(["448:updated+size", "640:editor", "848:access"]);
  });

  it("swaps the secondary line for the access column once it fits", () => {
    renderList();
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const accessLine = row.querySelector("[data-library-access-line]") as HTMLElement;
    expect(accessLine).toBeTruthy();
    expect(accessLine.textContent).toContain("Hạn chế");
    const hidesAt = rungOf(accessLine, /^hidden$/);
    // It hides at the very width the column appears, so the info is never shown twice or lost.
    expect(hidesAt).toBe(848);
    const access = Array.from(row.querySelectorAll("td")).filter((td) => rungOf(td, /^table-cell$/) === 848);
    expect(access).toHaveLength(1);
    expect(row.querySelectorAll("td").length).toBe(6);
    expect(document.querySelectorAll("colgroup col").length).toBe(6);
  });

  it("keeps the Restricted mark inside the Name cell: the title truncates, the mark does not", () => {
    renderList();
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const nameCell = row.querySelector("td") as HTMLElement;
    const title = nameCell.querySelector("span.truncate") as HTMLElement;
    expect(title.textContent).toBe("Báo cáo tổng kết quý");
    const line = nameCell.querySelector("[data-library-access-line]") as HTMLElement;
    expect(line).toHaveClass("min-w-0", "overflow-hidden");
    // The lock label never shrinks or wraps; whatever must give way (editor, date, size) is the truncating part.
    const mark = Array.from(line.querySelectorAll("span")).find((el) => el.textContent === "Hạn chế") as HTMLElement;
    const markBox = mark.closest("span.shrink-0") as HTMLElement;
    expect(markBox).toBeTruthy();
    expect(line.querySelector("span.truncate")).toBeTruthy();
  });
});
