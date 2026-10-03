// Views tests run in the Vietnamese locale (test/setup.ts), so the assertions
// use vi.json copy. The read seam is injected: the dialog's states are what is
// under test here, while read-compare.test.ts covers the real parse path.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocxCompareDialog, type DocxCompareDialogProps } from "./compare-dialog";
import type { CompareReadResult } from "./read-compare";

function pickFile(name = "other.docx"): void {
  const input = screen.getByTestId("docx-compare-file-input");
  fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], name)] } });
}

function renderDialog(overrides: Partial<DocxCompareDialogProps> = {}) {
  const props: DocxCompareDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    currentTexts: vi.fn(() => ["Alpha", "Gamma two"]),
    readFile: vi.fn(async (): Promise<CompareReadResult> => ({ ok: true, texts: ["Alpha", "Beta two"] })),
    ...overrides,
  };
  render(<DocxCompareDialog {...props} />);
  return props;
}

describe("DocxCompareDialog", () => {
  it("states the text-only limit and offers a .docx picker before any file is chosen", () => {
    renderDialog();
    expect(screen.getByText("So sánh tài liệu")).toBeInTheDocument();
    expect(screen.getByText(/Chỉ so sánh văn bản/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chọn tệp .docx" })).toBeEnabled();
    expect(screen.queryByTestId("docx-compare-result")).not.toBeInTheDocument();
  });

  it("compares the live document with the picked file and marks word-level changes", async () => {
    const props = renderDialog();
    pickFile();

    const summary = await screen.findByTestId("docx-compare-summary");
    expect(summary).toHaveTextContent("0 đoạn thêm · 0 đoạn bớt · 1 đoạn thay đổi");
    expect(screen.getByText("So sánh với other.docx")).toBeInTheDocument();
    expect(screen.getByTestId("docx-compare-same-run")).toHaveTextContent("1 đoạn giống nhau");

    const rows = within(screen.getByTestId("docx-compare-rows"));
    expect(rows.getByTestId("docx-compare-kind-changed")).toHaveTextContent("Thay đổi");
    expect(rows.getByText("Gamma")).toHaveAttribute("data-compare-word", "removed");
    expect(rows.getByText("Beta")).toHaveAttribute("data-compare-word", "added");
    expect(props.currentTexts).toHaveBeenCalledTimes(1);
    expect(props.readFile).toHaveBeenCalledWith(expect.objectContaining({ name: "other.docx" }));
  });

  it("reports identical documents without entry rows", async () => {
    renderDialog({
      currentTexts: () => ["Alpha"],
      readFile: vi.fn(async (): Promise<CompareReadResult> => ({ ok: true, texts: ["Alpha"] })),
    });
    pickFile();
    const summary = await screen.findByTestId("docx-compare-summary");
    expect(summary).toHaveTextContent("Không có khác biệt trong phần văn bản được so sánh.");
    expect(screen.queryByTestId("docx-compare-kind-changed")).not.toBeInTheDocument();
  });

  it("shows the reading state until the parse settles", async () => {
    let resolveRead!: (value: CompareReadResult) => void;
    renderDialog({
      readFile: vi.fn(() => new Promise<CompareReadResult>((resolve) => {
        resolveRead = resolve;
      })),
    });
    pickFile("slow.docx");

    const reading = await screen.findByTestId("docx-compare-reading");
    expect(reading).toHaveTextContent("Đang đọc slow.docx…");
    expect(screen.getByRole("button", { name: /Chọn tệp/ })).toBeDisabled();

    resolveRead({ ok: true, texts: ["Alpha", "Gamma two"] });
    expect(await screen.findByTestId("docx-compare-summary")).toHaveTextContent(
      "Không có khác biệt trong phần văn bản được so sánh.",
    );
  });

  it("refuses an unreadable file with a translated message and allows another pick", async () => {
    const readFile = vi
      .fn<() => Promise<CompareReadResult>>()
      .mockResolvedValueOnce({ ok: false, reason: "invalid_docx" })
      .mockResolvedValueOnce({ ok: true, texts: ["Alpha", "Gamma two"] });
    renderDialog({ readFile });
    pickFile("broken.docx");

    const alert = await screen.findByTestId("docx-compare-error");
    expect(alert).toHaveTextContent("Tệp đã chọn không phải là tài liệu .docx đọc được.");
    expect(screen.queryByTestId("docx-compare-result")).not.toBeInTheDocument();

    pickFile("good.docx");
    expect(await screen.findByTestId("docx-compare-summary")).toHaveTextContent(
      "Không có khác biệt trong phần văn bản được so sánh.",
    );
  });

  it("translates the unreadable-file refusal separately", async () => {
    renderDialog({ readFile: vi.fn(async (): Promise<CompareReadResult> => ({ ok: false, reason: "unreadable" })) });
    pickFile("gone.docx");
    expect(await screen.findByTestId("docx-compare-error")).toHaveTextContent("Không đọc được tệp đã chọn.");
  });

  it("closes through the footer button without comparing", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("docx-compare-close"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.readFile).not.toHaveBeenCalled();
  });
});
