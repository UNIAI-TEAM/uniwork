import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import type { Member } from "@uniwork/core/types/workspace";
import { DocumentsTrashView, type DocumentsTrashViewProps } from "./documents-trash-view";
import type { TrashActions } from "./use-trash-actions";
import type { DocumentSummaryRow } from "./library-rows";

// The Trash.dc.html layout (TRASH-01 Area 4): a dedicated 5-column table, no
// toolbar, with RESTORE-01's per-row commands — the action handlers are stubbed
// here; the mutations and the purge dialog are covered in documents-trash.test.tsx.

const NOW = new Date("2026-10-16T05:00:00Z");

function row(id: string, over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: `${id}.docx`,
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
    updated_at: "2026-10-01T03:00:00Z",
    archived_at: "2026-10-16T01:00:00Z",
    archived_by: "u2",
    purge_after: "2026-10-31T00:00:00Z",
    ...over,
  };
}

function node(id: string, title: string, children: DocumentTreeNode[] = []): DocumentTreeNode {
  return { id, title, kind: "folder", position: 0, children };
}

function member(over: Partial<Member> = {}): Member {
  return {
    workspace_id: "ws1",
    user_id: "u2",
    role: "member",
    email: "truong@example.com",
    display_name: "Mai Trường",
    ...over,
  } as Member;
}

function renderView(over: Partial<DocumentsTrashViewProps> = {}, actions: Partial<TrashActions> = {}) {
  const props: DocumentsTrashViewProps = {
    rows: [row("a")],
    loading: false,
    failure: null,
    onRetry: vi.fn(),
    actions: { onRestore: vi.fn(), onPurge: vi.fn(), isRestoring: () => false, dialog: null, ...actions },
    members: new Map([["u2", member()]]),
    membersReady: true,
    ...over,
  };
  return { props, ...render(<DocumentsTrashView {...props} />) };
}

describe("DocumentsTrashView", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("heads the page with the Trash title and the retention subtitle, and no toolbar", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Thùng rác" })).toBeInTheDocument();
    expect(screen.getByText(/Mục đã xóa được giữ 30 ngày rồi bị xóa vĩnh viễn/)).toBeInTheDocument();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("draws the five columns, the last one named for screen readers only", () => {
    renderView();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Tên", "Xóa bởi", "Xóa lúc", "Xóa vĩnh viễn sau", "Thao tác"]);
    expect(within(headers[4]!).getByText("Thao tác")).toHaveClass("sr-only");
  });

  it("names where each row came from: a folder, a known parent folder, or the workspace root", () => {
    renderView({
      tree: [node("f1", "Dự án cũ")],
      rows: [
        row("dir", { kind: "folder", title: "Dự án cũ" }),
        row("child", { parent_id: "f1", title: "Biên bản.docx" }),
        // A parent that was trashed too is named from the rows, not the tree.
        row("goneparent", { kind: "folder", title: "Hồ sơ hết hạn" }),
        row("child2", { parent_id: "goneparent", title: "Phụ lục.docx" }),
        row("loose", { title: "Nháp.docx" }),
        row("lost", { parent_id: "gone", title: "Mồ côi.docx" }),
      ],
    });
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Thư mục")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Trong thư mục “Dự án cũ”")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Trong thư mục “Hồ sơ hết hạn”")).toBeInTheDocument();
    expect(within(rows[4]!).getByText("Từ Tài liệu của workspace")).toBeInTheDocument();
    // A parent id that is in neither the tree nor the rows gets no subtitle.
    expect(within(rows[5]!).queryByText(/Từ |Trong /)).not.toBeInTheDocument();
    // TV-12: the truncating name keeps the full title on hover (native title).
    expect(within(rows[1]!).getByText("Biên bản.docx")).toHaveAttribute("title", "Biên bản.docx");
  });

  it("names the member who deleted the row in Xóa bởi, and falls back for a former member", () => {
    renderView({ rows: [row("a"), row("b", { archived_by: "u9" }), row("c", { archived_by: null })] });
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getAllByRole("cell")[1]).toHaveTextContent("Mai Trường");
    expect(within(rows[1]!).getAllByRole("cell")[1]).toHaveTextContent("Thành viên cũ");
    // No archived_by at all stays a dash; a members list that has not answered yet does not guess "former".
    expect(within(rows[2]!).getAllByRole("cell")[1]).toHaveTextContent("—");
  });

  it("keeps the table inside its container: no minimum width and no horizontal scroll wrapper", () => {
    renderView();
    const table = screen.getByRole("table");
    expect(table.className).not.toMatch(/min-w-/);
    // The secondary columns hide by the wrapper's own width (TV-2), so the
    // table must be a container-query child of a @container element.
    expect(table.closest("[class*='@container']")).toBeTruthy();
    for (const el of Array.from(table.querySelectorAll("colgroup col, th, td"))) {
      const bad = Array.from(el.classList).filter((token) => /^(max-)?(sm|md|lg|xl|2xl):/.test(token) || token.startsWith("min-w-"));
      expect(bad, el.outerHTML.slice(0, 80)).toEqual([]);
    }
  });

  it("always shows Name and the restore control: only Xóa bởi, Xóa lúc and Xóa vĩnh viễn sau hide by container width", () => {
    renderView();
    const heads = screen.getAllByRole("columnheader");
    const rung = (el: Element) => Array.from(el.classList).filter((token) => token === "hidden" || token.startsWith("@"));
    // Name and actions never carry a container rung.
    expect(rung(heads[0]!)).toEqual([]);
    expect(rung(heads[4]!)).toEqual([]);
    // The three secondary columns do, so Khôi phục is on screen at any width.
    expect(rung(heads[1]!).length).toBeGreaterThan(0);
    expect(rung(heads[2]!).length).toBeGreaterThan(0);
    expect(rung(heads[3]!).length).toBeGreaterThan(0);
    const rowEl = document.querySelector("[data-trash-row]") as HTMLElement;
    const cells = Array.from(rowEl.querySelectorAll("td"));
    expect(rung(cells[0]!)).toEqual([]);
    expect(rung(cells[4]!)).toEqual([]);
    expect(rung(cells[1]!).length).toBeGreaterThan(0);
    expect(rung(cells[2]!).length).toBeGreaterThan(0);
    expect(rung(cells[3]!).length).toBeGreaterThan(0);
  });

  it("carries deleted-at, the countdown and the deleter in the name cell until their columns join (RESTORE-01 phones)", () => {
    renderView({ rows: [row("a", { purge_after: "2026-10-20T00:00:00Z" })] });
    const name = (document.querySelector("[data-trash-row]") as HTMLElement).querySelector("td")!;
    const [stamp, deleter] = Array.from(name.querySelectorAll("[data-trash-meta]"));
    // One wrapping line (no truncate), gone once Xóa lúc + Xóa vĩnh viễn sau join at 40rem.
    expect(stamp).toHaveTextContent(/ · Còn 4 ngày$/);
    expect(stamp).toHaveClass("@min-[40rem]/trash:hidden");
    expect(stamp).not.toHaveClass("truncate");
    // The deleter line stays until Xóa bởi joins at 54rem.
    expect(deleter).toHaveTextContent("Mai Trường");
    expect(deleter).toHaveClass("@min-[54rem]/trash:hidden");
  });

  it("counts the purge deadline down in days from purge_after, names today, and marks an expired row", () => {
    renderView({
      rows: [
        row("n12", { purge_after: "2026-10-28T00:00:00Z" }),
        row("n0", { purge_after: "2026-10-16T09:00:00Z" }),
        row("nx", { purge_after: "2026-10-13T00:00:00Z" }),
        // A row the server never stamped stays a dash, never NaN or a guessed date.
        row("nostamp", { purge_after: null }),
      ],
    });
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getAllByRole("cell")[3]).toHaveTextContent("Còn 12 ngày");
    expect(within(rows[1]!).getAllByRole("cell")[3]).toHaveTextContent("Xóa hôm nay");
    expect(within(rows[2]!).getAllByRole("cell")[3]).toHaveTextContent("Đã quá hạn");
    expect(within(rows[3]!).getAllByRole("cell")[3]).toHaveTextContent("—");
  });

  it("pluralizes the countdown in English and marks the last week in red", async () => {
    await setLocale("en");
    renderView({
      rows: [
        row("one", { purge_after: "2026-10-17T12:00:00Z" }),
        row("seven", { purge_after: "2026-10-23T12:00:00Z" }),
        row("eight", { purge_after: "2026-10-24T12:00:00Z" }),
      ],
    });
    const [one, seven, eight] = screen.getAllByRole("row").slice(1);
    try {
      expect(within(one!).getAllByRole("cell")[3]).toHaveTextContent(/^1 day left$/);
      expect(within(seven!).getAllByRole("cell")[3]).toHaveTextContent(/^7 days left$/);
      expect(within(seven!).getAllByRole("cell")[3]).toHaveClass("text-destructive");
      expect(within(eight!).getAllByRole("cell")[3]).toHaveTextContent(/^8 days left$/);
      expect(within(eight!).getAllByRole("cell")[3]).not.toHaveClass("text-destructive");
    } finally {
      await setLocale("vi");
    }
  });

  it("formats Xóa lúc as one short stamp: the clock for today, a short day-month for another day", () => {
    renderView({
      rows: [
        row("today", { archived_at: "2026-10-16T01:00:00Z" }),
        row("earlier", { archived_at: "2026-10-10T03:00:00Z" }),
      ],
    });
    const rows = screen.getAllByRole("row").slice(1);
    // No long date-time (dd/mm/yyyy hh:mm) in the cell.
    expect(within(rows[0]!).getAllByRole("cell")[2]!.textContent).not.toMatch(/\d{4}/);
    expect(within(rows[0]!).getAllByRole("cell")[2]!.textContent).not.toBe("");
    expect(within(rows[1]!).getAllByRole("cell")[2]).toHaveTextContent(/10\/10/);
  });

  it("offers Khôi phục and Xóa vĩnh viễn on a row the viewer manages, and calls the actions with it", () => {
    const manage = row("m", { my_level: "manage" });
    const onRestore = vi.fn();
    const onPurge = vi.fn();
    renderView({ rows: [manage] }, { onRestore, onPurge });
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục m.docx" }));
    expect(onRestore).toHaveBeenCalledWith(manage);
    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn m.docx" }));
    expect(onPurge).toHaveBeenCalledWith(manage);
    expect(screen.queryByText("Chỉ xem · người quản lý khôi phục")).not.toBeInTheDocument();
  });

  it("keeps the actions on a restricted row a workspace admin sees (admin_scope, no my_level)", () => {
    renderView({ rows: [row("a", { my_level: undefined, admin_scope: true })] });
    expect(screen.getByRole("button", { name: "Khôi phục a.docx" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xóa vĩnh viễn a.docx" })).toBeInTheDocument();
  });

  it("says view-only instead of offering actions below manage", () => {
    renderView({ rows: [row("e", { my_level: "edit" }), row("v", { my_level: "view" }), row("n", { my_level: undefined })] });
    expect(screen.queryByRole("button", { name: /Khôi phục/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xóa vĩnh viễn/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Chỉ xem · người quản lý khôi phục")).toHaveLength(3);
  });

  it("disables the row's restore while it runs, so a second click sends nothing", () => {
    const onRestore = vi.fn();
    renderView({ rows: [row("a")] }, { onRestore, isRestoring: (id) => id === "a" });
    const button = screen.getByRole("button", { name: "Khôi phục a.docx" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("opens a document from its title when onOpen is given, but not a folder or an edit-only row", () => {
    const onOpen = vi.fn();
    const doc = row("d", { title: "Báo cáo.docx" });
    renderView({
      onOpen,
      rows: [doc, row("dir", { kind: "folder", title: "Thư mục cũ" }), row("ro", { title: "Chỉ xem.docx", my_level: "edit" })],
    });
    // The row's name button carries title + origin; filter on text content so
    // the restore/purge aria-labels (which name the title too) cannot collide.
    const nameButton = screen.getAllByRole("button").find((el) => el.textContent?.includes("Báo cáo.docx") && !el.getAttribute("aria-label"));
    expect(nameButton).toBeTruthy();
    fireEvent.click(nameButton!);
    expect(onOpen).toHaveBeenCalledWith(doc);
    // A trashed folder never browses, and an edit-only row opens nothing (T-3).
    expect(screen.queryByRole("button", { name: /^Thư mục cũ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Chỉ xem\.docx/ })).not.toBeInTheDocument();
  });

  it("ends with the footer note on how restore works", () => {
    renderView();
    expect(screen.getByText(/Khôi phục từng mục: tài liệu về lại thư mục cũ nếu thư mục còn/)).toBeInTheDocument();
    expect(screen.getByText(/Chủ tài liệu nhận thông báo khi người khác chuyển tài liệu của họ vào thùng rác/)).toBeInTheDocument();
  });

  it("says the trash is empty, with no table and no mock rows", () => {
    renderView({ rows: [] });
    expect(screen.getByRole("heading", { name: "Thùng rác đang trống" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Thùng rác" })).toBeInTheDocument();
  });

  it("shows a busy skeleton while loading and an error with retry on failure", () => {
    const { rerender, props } = renderView({ loading: true, rows: [] });
    expect(screen.getByLabelText("Đang tải danh sách tài liệu…")).toHaveAttribute("aria-busy", "true");
    rerender(<DocumentsTrashView {...props} loading={false} failure="error" rows={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được danh sách tài liệu");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(props.onRetry).toHaveBeenCalled();
  });
});
