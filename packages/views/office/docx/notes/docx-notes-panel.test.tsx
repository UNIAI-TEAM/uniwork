// Views suite runs with the Vietnamese locale (test/setup.ts), so the copy
// asserted here is the vi.json one.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxNoteInfo } from "@uniwork/office-engine/docx";
import { DocxNotesPanel, type DocxNotesPanelProps } from "./docx-notes-panel";

const FOOTNOTES: DocxNoteInfo[] = [
  { id: "1", text: "ghi chú một" },
  { id: "2", text: "ghi chú hai" },
];
const ENDNOTES: DocxNoteInfo[] = [{ id: "1", text: "kết luận" }];

function renderPanel(overrides: Partial<DocxNotesPanelProps> = {}) {
  const props: DocxNotesPanelProps = {
    footnotes: FOOTNOTES,
    endnotes: ENDNOTES,
    readOnly: false,
    hasRef: () => true,
    numberOf: (kind, id) => {
      const notes = kind === "footnote" ? FOOTNOTES : ENDNOTES;
      return notes.findIndex((note) => note.id === id) + 1;
    },
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onJump: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<DocxNotesPanel {...props} />);
  return props;
}

describe("DocxNotesPanel", () => {
  it("lists both kinds with numbers, text and part labels", () => {
    renderPanel();
    expect(screen.getByText("Chú thích")).toBeInTheDocument();
    expect(screen.getByText("Chú thích chân trang")).toBeInTheDocument();
    expect(screen.getByText("Chú thích cuối văn bản")).toBeInTheDocument();
    expect(screen.getByText("ghi chú một")).toBeInTheDocument();
    expect(screen.getByText("ghi chú hai")).toBeInTheDocument();
    expect(screen.getByText("kết luận")).toBeInTheDocument();
  });

  it("numbers the badge from the caller's reference order, not part order (M-5)", () => {
    // The markers number by body-reference order; the pane must match. Here
    // the caller says note 2 comes first, so its badge is 1 and note 1 is 2.
    renderPanel({ numberOf: (_kind, id) => (id === "2" ? 1 : 2) });
    expect(screen.getByTestId("docx-note-number-footnote-1")).toHaveTextContent("2");
    expect(screen.getByTestId("docx-note-number-footnote-2")).toHaveTextContent("1");
  });

  it("edits a note's text inline", () => {
    const props = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "Sửa" })[0]!);
    const input = screen.getByLabelText("Nội dung chú thích");
    fireEvent.change(input, { target: { value: "  nội dung mới  " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(props.onEdit).toHaveBeenCalledWith("footnote", "1", "nội dung mới");
  });

  it("deletes only after the confirm dialog", async () => {
    const props = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "Xóa" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Xóa chú thích này?")).toBeInTheDocument();
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa chú thích" }));
    expect(props.onDelete).toHaveBeenCalledWith("footnote", "1");
  });

  it("jumps when a note row is picked", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByText("kết luận"));
    expect(props.onJump).toHaveBeenCalledWith("endnote", "1");
  });

  it("flags a note whose reference is gone and blocks its jump", () => {
    const props = renderPanel({ hasRef: (kind, id) => !(kind === "footnote" && id === "1") });
    expect(screen.getAllByText("Không tìm thấy dấu tham chiếu trong văn bản").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /ghi chú một/ })).toBeDisabled();
    expect(props.onJump).not.toHaveBeenCalled();
  });

  it("shows the empty state", () => {
    renderPanel({ footnotes: [], endnotes: [] });
    expect(screen.getByText("Chưa có chú thích nào.")).toBeInTheDocument();
    expect(screen.getByText(/Đặt con trỏ/)).toBeInTheDocument();
  });

  it("keeps notes readable but not editable on a read-only document", () => {
    const props = renderPanel({ readOnly: true });
    expect(screen.getByText(/chỉ đọc/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sửa" })[0]!).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Xóa" })[0]!).toBeDisabled();
    // jumping stays available
    fireEvent.click(screen.getByText("kết luận"));
    expect(props.onJump).toHaveBeenCalledWith("endnote", "1");
  });
});
