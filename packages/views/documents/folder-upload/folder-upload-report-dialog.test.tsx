import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderUploadReportDialog } from "./folder-upload-report-dialog";

const failures = [
  { path: "Báo cáo/2026/a.docx", code: "quota_exceeded" },
  { path: "Báo cáo/b.pdf", code: "some_future_code" },
  { path: "Báo cáo/c.xlsx" },
];

function renderReport(over: Partial<Parameters<typeof FolderUploadReportDialog>[0]> = {}) {
  const onRetry = vi.fn();
  render(
    <FolderUploadReportDialog open onOpenChange={() => undefined} name="Báo cáo" failures={failures} onRetry={onRetry} {...over} />,
  );
  return { onRetry };
}

describe("FolderUploadReportDialog", () => {
  it("lists each failed path with the sentence of its code, and the generic one for a code it does not know", () => {
    renderReport();
    expect(screen.getByText("«Báo cáo»: 3 tệp bị lỗi. Các tệp còn lại đã được giữ nguyên.")).toBeInTheDocument();
    expect(screen.getByText("Báo cáo/2026/a.docx")).toBeInTheDocument();
    expect(screen.getByText("Đã hết dung lượng lưu trữ.")).toBeInTheDocument();
    expect(screen.getAllByText("Không tải lên được tệp này.")).toHaveLength(2);
  });

  it("retries only on request and blocks a second press while retrying", () => {
    const { onRetry } = renderReport();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại các tệp lỗi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the retry button aria-disabled while a retry runs", () => {
    const { onRetry } = renderReport({ retrying: true });
    const button = screen.getByRole("button", { name: "Đang thử lại…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
