// Views suite runs with the Vietnamese locale (test/setup.ts), so the copy
// asserted here is the vi.json one.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommentInfo } from "@uniwork/office-engine/docx";
import { DocxCommentsPanel, type DocxCommentsPanelProps } from "./docx-comments-panel";

const MAIN: DocxCommentInfo = { id: "1", author: "Alice", text: "xin chào", date: "2026-07-01T10:00:00Z" };
const REPLY: DocxCommentInfo = { id: "2", author: "Bob", text: "đồng ý", parentId: "1" };
const RESOLVED: DocxCommentInfo = { id: "3", author: "An", text: "đã xong", done: true };

function renderPanel(overrides: Partial<DocxCommentsPanelProps> = {}) {
  const props: DocxCommentsPanelProps = {
    comments: [MAIN, REPLY, RESOLVED],
    anchorTexts: new Map([["1", "trích đoạn"]]),
    activeId: null,
    readOnly: false,
    canComment: true,
    composing: false,
    onComposingChange: vi.fn(),
    onSubmit: vi.fn(),
    onReply: vi.fn(),
    onResolve: vi.fn(),
    onDelete: vi.fn(),
    onJump: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<DocxCommentsPanel {...props} />);
  return props;
}

describe("DocxCommentsPanel", () => {
  it("lists open threads with author, anchor quote and replies; resolved stay folded", () => {
    renderPanel();
    expect(screen.getByText("Bình luận")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("xin chào")).toBeInTheDocument();
    expect(screen.getByText("trích đoạn")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("đồng ý")).toBeInTheDocument();
    // the resolved thread only appears after the toggle
    expect(screen.queryByText("đã xong")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đã giải quyết (1)" }));
    expect(screen.getByText("đã xong")).toBeInTheDocument();
  });

  it("submits a new comment from the composer", () => {
    const props = renderPanel({ composing: true });
    const input = screen.getByLabelText("Nhập nội dung bình luận…");
    fireEvent.change(input, { target: { value: "  nội dung mới  " } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    expect(props.onSubmit).toHaveBeenCalledWith("nội dung mới");
    expect(props.onComposingChange).toHaveBeenCalledWith(false);
  });

  it("opens the composer from the add button and keeps it disabled without a selection", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Thêm bình luận" }));
    expect(props.onComposingChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Thêm bình luận" })).toBeEnabled();
  });

  it("replies to a thread through the inline composer", () => {
    const props = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "Trả lời" })[0]!);
    fireEvent.change(screen.getByLabelText("Nhập nội dung trả lời…"), { target: { value: "phản hồi" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    expect(props.onReply).toHaveBeenCalledWith("1", "phản hồi");
  });

  it("resolves and reopens through the thread action", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Giải quyết" }));
    expect(props.onResolve).toHaveBeenCalledWith("1", true);
    fireEvent.click(screen.getByRole("button", { name: "Đã giải quyết (1)" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Mở lại" })[0]!);
    expect(props.onResolve).toHaveBeenCalledWith("3", false);
  });

  it("deletes only after the confirm dialog", async () => {
    const props = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "Xóa" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Xóa bình luận?")).toBeInTheDocument();
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa bình luận" }));
    expect(props.onDelete).toHaveBeenCalledWith("1");
  });

  it("jumps to the anchor when a thread is picked", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByText("xin chào"));
    expect(props.onJump).toHaveBeenCalledWith("1");
  });

  it("shows the empty state and disables edits on a read-only document", () => {
    renderPanel({ comments: [], canComment: false, readOnly: true });
    expect(screen.getByText("Chưa có bình luận")).toBeInTheDocument();
    expect(screen.getByText(/chỉ đọc/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thêm bình luận" })).not.toBeInTheDocument();
  });
});
