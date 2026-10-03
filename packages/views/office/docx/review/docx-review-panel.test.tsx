// Views tests run with the Vietnamese locale (test/setup.ts), so the copy
// asserted here is the vi.json one. The panel itself is presentational: every
// action is a callback, so the assertions are call + enabled state only.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocxReviewPanel, type DocxReviewPanelProps } from "./docx-review-panel";
import type { DocxReviewChange } from "./revision-model";

const INS: DocxReviewChange = {
  id: "ins:1:6",
  kind: "ins",
  author: "Alice",
  date: "2026-01-02T03:04:05Z",
  from: 1,
  to: 6,
  snippet: "đoạn được chèn",
};
const DEL: DocxReviewChange = {
  id: "del:7:10",
  kind: "del",
  author: "Bob",
  from: 7,
  to: 10,
  snippet: "đoạn bị xóa",
};

function renderPanel(overrides: Partial<DocxReviewPanelProps> = {}) {
  const props: DocxReviewPanelProps = {
    changes: [INS, DEL],
    activeId: null,
    readOnly: false,
    busy: false,
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onAcceptAll: vi.fn(),
    onRejectAll: vi.fn(),
    onJump: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<DocxReviewPanel {...props} />);
  return props;
}

describe("DocxReviewPanel", () => {
  it("lists the changes with kind, author, snippet and count", () => {
    renderPanel();
    expect(screen.getByText("Thay đổi được theo dõi")).toBeInTheDocument();
    expect(screen.getByText("2 thay đổi")).toBeInTheDocument();
    expect(screen.getByText("Chèn")).toBeInTheDocument();
    expect(screen.getByText("Xóa")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("đoạn được chèn")).toBeInTheDocument();
    expect(screen.getByText("đoạn bị xóa")).toBeInTheDocument();
  });

  it("jumps to a change from its snippet", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Đến thay đổi: đoạn được chèn" }));
    expect(props.onJump).toHaveBeenCalledWith(INS.id);
  });

  it("accepts and rejects one change each", () => {
    const props = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: /Chấp nhận thay đổi/ })[0]!);
    expect(props.onAccept).toHaveBeenCalledWith(INS.id);
    fireEvent.click(screen.getAllByRole("button", { name: /Từ chối thay đổi/ })[1]!);
    expect(props.onReject).toHaveBeenCalledWith(DEL.id);
  });

  it("confirms accept-all before acting", async () => {
    const props = renderPanel();
    fireEvent.click(screen.getByTestId("docx-review-accept-all"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Chấp nhận tất cả thay đổi?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Cả 2 thay đổi/)).toBeInTheDocument();
    expect(props.onAcceptAll).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Chấp nhận tất cả thay đổi" }));
    expect(props.onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it("confirms reject-all before acting", async () => {
    const props = renderPanel();
    fireEvent.click(screen.getByTestId("docx-review-reject-all"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Từ chối tất cả thay đổi?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Từ chối tất cả thay đổi" }));
    expect(props.onRejectAll).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state without bulk actions", () => {
    renderPanel({ changes: [] });
    expect(screen.getByText("Không có thay đổi được theo dõi")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-review-accept-all")).not.toBeInTheDocument();
  });

  it("shows a loading state until the list is readable", () => {
    renderPanel({ changes: null });
    expect(screen.getByText("Đang tải thay đổi…")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-review-accept-all")).not.toBeInTheDocument();
  });

  it("keeps the list but disables every action on a read-only document", () => {
    renderPanel({ readOnly: true });
    expect(screen.getByText(/chỉ đọc/)).toBeInTheDocument();
    expect(screen.getByText("đoạn được chèn")).toBeInTheDocument();
    expect(screen.getByTestId("docx-review-accept-all")).toBeDisabled();
    expect(screen.getByTestId("docx-review-reject-all")).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: /Chấp nhận thay đổi/ })) {
      expect(button).toBeDisabled();
    }
    for (const button of screen.getAllByRole("button", { name: /Từ chối thay đổi/ })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Đến thay đổi: đoạn được chèn" })).toBeEnabled();
  });
});
