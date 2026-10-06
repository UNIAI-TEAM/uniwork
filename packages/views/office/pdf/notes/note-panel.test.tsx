import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfNotesPanel } from "./note-panel";
import type { PdfNoteOperationProvider, PdfNoteRect, PdfNoteRow, PdfNoteThread } from "./types";

const RECT: PdfNoteRect = [10, 20, 30, 40];

const root: PdfNoteRow = { id: "n1", page: 2, pageIndex: 1, objNum: 7, rect: RECT, contents: "Ghi chú gốc", author: "An" };
const replyNote: PdfNoteRow = { id: "n2", page: 2, pageIndex: 1, objNum: 8, rect: RECT, contents: "Phản hồi", author: "Bình" };
const thread: PdfNoteThread = { id: "t1", root, replies: [replyNote] };

function provider(): PdfNoteOperationProvider {
  return { addNote: vi.fn(), replyToNote: vi.fn(), editNote: vi.fn(), resolveNote: vi.fn() };
}

describe("PdfNotesPanel", () => {
  it("renders threads with their replies", () => {
    render(<PdfNotesPanel threads={[thread]} provider={provider()} />);
    expect(screen.getByText("Ghi chú gốc")).toBeInTheDocument();
    expect(screen.getByText("Phản hồi")).toBeInTheDocument();
    expect(screen.getAllByText(/Trang 2/)).toHaveLength(2);
  });

  it("draws the thread actions as icon buttons that never wrap", () => {
    render(<PdfNotesPanel threads={[thread]} provider={provider()} />);
    for (const name of ["Đánh dấu đã xử lý", "Sửa", "Trả lời"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("whitespace-nowrap");
      expect(button.querySelector("svg[aria-hidden=true]")).not.toBeNull();
    }
  });

  it("shows an empty state when the document has no notes", () => {
    render(<PdfNotesPanel threads={[]} provider={provider()} />);
    expect(screen.getByText("Chưa có ghi chú nào trong tài liệu.")).toBeInTheDocument();
  });

  it("submits a reply against the thread root identity", async () => {
    const host = provider();
    render(<PdfNotesPanel threads={[thread]} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Trả lời" }));
    fireEvent.change(screen.getByLabelText("Trả lời"), { target: { value: "Đồng ý" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi trả lời" }));
    await waitFor(() =>
      expect(host.replyToNote).toHaveBeenCalledWith({
        replyTo: { pageIndex: 1, objNum: 7, rect: RECT, contents: "Ghi chú gốc" },
        contents: "Đồng ý",
      }),
    );
  });

  it("edits a note with its saved identity and the draft text", async () => {
    const host = provider();
    render(<PdfNotesPanel threads={[thread]} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    fireEvent.change(screen.getByLabelText("Sửa"), { target: { value: "Gốc đã sửa" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));
    await waitFor(() =>
      expect(host.editNote).toHaveBeenCalledWith({
        identity: { pageIndex: 1, objNum: 7, rect: RECT, contents: "Ghi chú gốc" },
        contents: "Gốc đã sửa",
      }),
    );
  });

  it("toggles the resolve state through the provider", async () => {
    const host = provider();
    const { rerender } = render(<PdfNotesPanel threads={[thread]} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Đánh dấu đã xử lý" }));
    await waitFor(() =>
      expect(host.resolveNote).toHaveBeenCalledWith({
        identity: { pageIndex: 1, objNum: 7, rect: RECT, contents: "Ghi chú gốc" },
        resolved: true,
      }),
    );
    rerender(<PdfNotesPanel threads={[{ ...thread, root: { ...root, resolved: true } }]} provider={host} />);
    expect(screen.getByRole("button", { name: "Mở lại" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Đã xử lý/)).toBeInTheDocument();
  });

  it("keeps a note the host cannot act on read-only", () => {
    render(<PdfNotesPanel threads={[{ ...thread, root: { ...root, binding: "unbound" } }]} provider={provider()} />);
    expect(screen.getByText("Chỉ đọc")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sửa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trả lời" })).not.toBeInTheDocument();
  });

  it("keeps every thread read-only without a provider", () => {
    render(<PdfNotesPanel threads={[thread]} />);
    expect(screen.getAllByText("Chỉ đọc").length).toBeGreaterThan(0);
  });

  it("composes a new root note at the add target", async () => {
    const host = provider();
    render(<PdfNotesPanel threads={[]} provider={host} addTarget={{ pageIndex: 1, rect: RECT, page: 2 }} />);
    fireEvent.change(screen.getByLabelText("Thêm ghi chú"), { target: { value: "Ghi chú mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm ghi chú" }));
    await waitFor(() => expect(host.addNote).toHaveBeenCalledWith({ pageIndex: 1, rect: RECT, contents: "Ghi chú mới" }));
  });

  it("shows a localized alert when the host rejects the action", async () => {
    const host = provider();
    vi.mocked(host.resolveNote).mockRejectedValueOnce(new Error("engine down"));
    render(<PdfNotesPanel threads={[thread]} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Đánh dấu đã xử lý" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Không thể áp dụng thao tác ghi chú. Thử lại."));
  });

  it("disables actions in a read-only host", () => {
    render(<PdfNotesPanel threads={[thread]} provider={provider()} addTarget={{ pageIndex: 1, rect: RECT }} disabled />);
    expect(screen.getByRole("button", { name: "Đánh dấu đã xử lý" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sửa" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Thêm ghi chú" })).toBeDisabled();
  });
});
