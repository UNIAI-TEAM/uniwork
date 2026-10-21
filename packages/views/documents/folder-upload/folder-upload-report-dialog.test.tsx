import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderUploadReportDialog } from "./folder-upload-report-dialog";

const failures = [
  { path: "Báo cáo/2026/a.docx", code: "storage_quota_exceeded" },
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

  it("retries only on request", () => {
    const { onRetry } = renderReport();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại các tệp lỗi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the retry button after the batch expired and says why", () => {
    renderReport({ canRetry: false });
    expect(screen.queryByRole("button", { name: "Thử lại các tệp lỗi" })).toBeNull();
    expect(screen.getByText("Lượt tải lên đã hết hạn nên không thử lại được. Hãy tải lại thư mục.")).toBeInTheDocument();
  });
});
