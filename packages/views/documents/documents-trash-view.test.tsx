import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { DocumentsTrashView, type DocumentsTrashViewProps } from "./documents-trash-view";
import type { DocumentSummaryRow } from "./library-rows";

// The Trash.dc.html layout (TRASH-01 Area 4): a dedicated 5-column table, no
// toolbar. archived_by and purge_after are not in the data, so "Xóa bởi" is a
// dash and the days left are computed from archived_at + 30 days.

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
    ...over,
  };
}

function node(id: string, title: string, children: DocumentTreeNode[] = []): DocumentTreeNode {
  return { id, title, kind: "folder", position: 0, children };
}

function renderView(over: Partial<DocumentsTrashViewProps> = {}) {
  const props: DocumentsTrashViewProps = {
    wsId: "ws1",
    rows: [row("a")],
    loading: false,
    failure: null,
    onRetry: vi.fn(),
    onRestore: vi.fn(),
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
        row("loose", { title: "Nháp.docx" }),
        row("lost", { parent_id: "gone", title: "Mồ côi.docx" }),
      ],
    });
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Thư mục")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Trong thư mục “Dự án cũ”")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Từ Tài liệu của workspace")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Từ Tài liệu của workspace")).toBeInTheDocument();
  });

  it("shows a muted dash in Xóa bởi that names the missing data, never an invented person", () => {
    renderView({ rows: [row("a", { updated_by: "someone-else" })] });
    const cell = screen.getAllByRole("cell")[1]!;
    const dash = within(cell).getByLabelText("Chưa có dữ liệu");
    expect(dash).toHaveTextContent("—");
    expect(dash).toHaveClass("text-muted-foreground");
    expect(cell).not.toHaveTextContent("someone-else");
  });

  it("formats Xóa lúc from archived_at and counts the days left from archived_at + 30 days", () => {
    renderView({ rows: [row("a", { archived_at: "2026-10-16T01:00:00Z" })] });
    const cells = screen.getAllByRole("cell");
    expect(cells[2]!.textContent).toMatch(/16\/10\/2026|16\/10\/26/);
    expect(cells[3]).toHaveTextContent("30 ngày");
    expect(cells[3]).not.toHaveClass("text-destructive");
  });

  it("turns the days left red at 7 days or fewer, and only then", () => {
    renderView({
      rows: [
        row("seven", { archived_at: "2026-09-23T05:00:00Z" }),
        row("eight", { archived_at: "2026-09-24T05:00:00Z" }),
      ],
    });
    const [seven, eight] = screen.getAllByRole("row").slice(1);
    const sevenLeft = within(seven!).getAllByRole("cell")[3]!;
    const eightLeft = within(eight!).getAllByRole("cell")[3]!;
    expect(sevenLeft).toHaveTextContent("7 ngày");
    expect(sevenLeft).toHaveClass("text-destructive");
    expect(eightLeft).toHaveTextContent("8 ngày");
    expect(eightLeft).not.toHaveClass("text-destructive");
  });

  it("offers Khôi phục for a row the viewer manages and calls onRestore with it", () => {
    const manage = row("m", { my_level: "manage" });
    const { props } = renderView({ rows: [manage] });
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục" }));
    expect(props.onRestore).toHaveBeenCalledWith(manage);
    expect(screen.queryByText("Chỉ xem · người quản lý khôi phục")).not.toBeInTheDocument();
  });

  it("says view-only instead of offering restore below manage", () => {
    renderView({ rows: [row("e", { my_level: "edit" }), row("v", { my_level: "view" }), row("n", { my_level: undefined })] });
    expect(screen.queryByRole("button", { name: "Khôi phục" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Chỉ xem · người quản lý khôi phục")).toHaveLength(3);
  });

  it("renders no delete-forever control without the prop, and one wired to it with the prop", () => {
    const manage = row("m");
    const { rerender, props } = renderView({ rows: [manage] });
    expect(screen.queryByRole("button", { name: "Xóa" })).not.toBeInTheDocument();
    const onDeleteForever = vi.fn();
    rerender(<DocumentsTrashView {...props} onDeleteForever={onDeleteForever} />);
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    expect(onDeleteForever).toHaveBeenCalledWith(manage);
  });

  it("opens a document from its title when onOpen is given, but not a trashed folder", () => {
    const onOpen = vi.fn();
    const doc = row("d", { title: "Báo cáo.docx" });
    renderView({ onOpen, rows: [doc, row("dir", { kind: "folder", title: "Thư mục cũ" })] });
    fireEvent.click(screen.getByRole("button", { name: /Báo cáo\.docx/ }));
    expect(onOpen).toHaveBeenCalledWith(doc);
    expect(screen.queryByRole("button", { name: /Thư mục cũ/ })).not.toBeInTheDocument();
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
