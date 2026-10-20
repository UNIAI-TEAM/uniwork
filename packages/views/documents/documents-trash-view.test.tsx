import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsTrashView, type DocumentsTrashViewProps } from "./documents-trash-view";
import type { LibraryRowHandlers } from "./documents-library-row";
import type { TrashActions } from "./use-trash-actions";
import { documentRow, type DocumentSummaryRow } from "./library-rows";

// The Thùng rác wrapper (UNI-2045 W2): its heading, the 30-day intro and the
// restore note around the shared list with screen="trash". The row cells and
// the menu are covered in doclist/ and documents-trash.test.tsx; the
// mutations and the purge dialog there too.

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

function handlers(over: Partial<LibraryRowHandlers> = {}): LibraryRowHandlers {
  return {
    onOpen: vi.fn(),
    onFolder: vi.fn(),
    onGoToSource: vi.fn(),
    onDownloadSource: vi.fn(),
    onSaveSource: vi.fn(),
    isStarred: () => false,
    personName: () => null,
    member: (id) => (id === "u2" ? { name: "Mai Trường", avatarUrl: null } : "former"),
    ...over,
  };
}

function renderView(over: Partial<DocumentsTrashViewProps> = {}, actions: Partial<TrashActions> = {}) {
  const props: DocumentsTrashViewProps = {
    rows: [documentRow(row("a"))],
    loading: false,
    failure: null,
    onRetry: vi.fn(),
    actions: { onRestore: vi.fn(), onPurge: vi.fn(), isRestoring: () => false, dialog: null, ...actions },
    handlers: handlers(),
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

  it("heads the page with the Trash title and the 30-day subtitle, and no toolbar", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Thùng rác" })).toBeInTheDocument();
    expect(screen.getByText(/Mục đã xóa được giữ 30 ngày rồi bị xóa vĩnh viễn/)).toBeInTheDocument();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("draws the shared columns with Đã xóa after Tên, in a table named Thùng rác", () => {
    renderView();
    const table = screen.getByRole("table", { name: "Thùng rác" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Tên", "Đã xóa", "Truy cập", "Người sửa gần nhất", "Cập nhật", "Dung lượng", "Thao tác"]);
    expect(within(headers[6]!).getByText("Thao tác")).toHaveClass("sr-only");
  });

  it("puts Khôi phục on the row for a manager and calls the action with the row", () => {
    const { props } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục a.docx" }));
    expect(props.actions.onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("disables the row's Khôi phục while it runs, so a second click sends nothing", () => {
    renderView({}, { isRestoring: (id) => id === "a" });
    expect(screen.getByRole("button", { name: "Khôi phục a.docx" })).toBeDisabled();
  });

  it("says view-only and offers no command on a row the viewer only edits", () => {
    renderView({ rows: [documentRow(row("b", { my_level: "edit" }))] });
    expect(screen.queryByRole("button", { name: "Khôi phục b.docx" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thao tác cho b.docx" })).not.toBeInTheDocument();
    expect(screen.getByText("Chỉ xem · người quản lý khôi phục")).toBeInTheDocument();
  });

  it("opens a document from its title for a manager, never a folder or an edit-only row", () => {
    const onOpen = vi.fn();
    renderView({
      rows: [
        documentRow(row("doc")),
        documentRow(row("dir", { kind: "folder", title: "Thư mục cũ" })),
        documentRow(row("ro", { my_level: "edit", title: "Chỉ xem.docx" })),
      ],
      handlers: handlers({ onOpen }),
    });
    fireEvent.click(screen.getByRole("button", { name: /^doc\.docx/ }));
    expect(onOpen).toHaveBeenCalledWith("doc");
    expect(screen.queryByRole("button", { name: /^Thư mục cũ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Chỉ xem\.docx/ })).not.toBeInTheDocument();
  });

  it("ends with the footer note on how restore works", () => {
    renderView();
    expect(screen.getByText(/Khôi phục từng mục: tài liệu về lại thư mục cũ nếu thư mục còn/)).toBeInTheDocument();
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
