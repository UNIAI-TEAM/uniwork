import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfPageOpsPanel, parsePageRanges } from "./panel";
import type { PdfNewDocument, PdfPageOpsOperationProvider, PdfPageOpsResult } from "./types";

const EMPTY: PdfPageOpsResult = { documents: [], warnings: [] };

function provider(overrides: Partial<PdfPageOpsOperationProvider> = {}): PdfPageOpsOperationProvider {
  return {
    insertBlankPage: vi.fn(async () => EMPTY),
    insertPdfPages: vi.fn(async () => EMPTY),
    extractPages: vi.fn(async () => EMPTY),
    mergePdfs: vi.fn(async () => EMPTY),
    splitPdf: vi.fn(async () => EMPTY),
    ...overrides,
  };
}

const ASSETS = [
  { id: "asset-a", label: "Phụ lục A" },
  { id: "asset-b", label: "Phụ lục B" },
];

describe("parsePageRanges", () => {
  it("parses single pages, ranges and dedupes in order", () => {
    expect(parsePageRanges("1-3, 5, 2", 5)).toEqual([1, 2, 3, 5]);
    expect(parsePageRanges("4", 4)).toEqual([4]);
  });

  it("rejects blank, malformed and out-of-range text", () => {
    expect(parsePageRanges("", 3)).toBeNull();
    expect(parsePageRanges("abc", 3)).toBeNull();
    expect(parsePageRanges("0", 3)).toBeNull();
    expect(parsePageRanges("3-2", 3)).toBeNull();
    expect(parsePageRanges("4", 3)).toBeNull();
  });
});

describe("PdfPageOpsPanel", () => {
  it("renders every section and an empty asset state", () => {
    render(<PdfPageOpsPanel pages={[1, 2]} provider={provider()} />);
    expect(screen.getByRole("heading", { name: "Thao tác trang" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chèn trang trắng" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trích xuất trang" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gộp PDF" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tách tài liệu" })).toBeInTheDocument();
    expect(screen.getAllByText("Chưa có PDF nào để chọn.")).toHaveLength(2);
  });

  it("inserts a blank page at the displayed anchor and reports the change", async () => {
    const host = provider();
    const onApplied = vi.fn();
    render(<PdfPageOpsPanel pages={[1, 2, 3]} provider={host} onApplied={onApplied} />);
    fireEvent.change(screen.getByLabelText("Chèn sau trang"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Chiều rộng"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Chiều cao"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Chèn trang trắng" }));
    await waitFor(() =>
      expect(host.insertBlankPage).toHaveBeenCalledWith({ afterPageIndex: 1, size: { width: 200, height: 300 } }),
    );
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("inserts the chosen PDF asset", async () => {
    const host = provider();
    render(<PdfPageOpsPanel pages={[1, 2]} provider={host} assetOptions={ASSETS} />);
    fireEvent.click(screen.getByRole("button", { name: "Phụ lục B" }));
    fireEvent.click(screen.getByRole("button", { name: "Chèn các trang" }));
    await waitFor(() =>
      expect(host.insertPdfPages).toHaveBeenCalledWith({ afterPageIndex: -1, assetId: "asset-b" }),
    );
  });

  it("extracts the selected pages through the selection button", async () => {
    const host = provider();
    render(<PdfPageOpsPanel pages={[1, 2, 3]} provider={host} selectedPages={[2]} />);
    fireEvent.click(screen.getByRole("button", { name: "Trích xuất 1 trang đã chọn" }));
    await waitFor(() => expect(host.extractPages).toHaveBeenCalledWith({ pages: [2] }));
  });

  it("extracts parsed ranges as zero-based positions", async () => {
    const host = provider();
    render(<PdfPageOpsPanel pages={[1, 2, 3]} provider={host} />);
    fireEvent.change(screen.getByLabelText("Khoảng trang"), { target: { value: "1-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Trích xuất" }));
    await waitFor(() => expect(host.extractPages).toHaveBeenCalledWith({ pages: [0, 1] }));
  });

  it("rejects a malformed range with a localized alert and no submit", () => {
    const host = provider();
    render(<PdfPageOpsPanel pages={[1, 2]} provider={host} />);
    fireEvent.change(screen.getByLabelText("Khoảng trang"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Trích xuất" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Trang hoặc khoảng trang không hợp lệ.");
    expect(host.extractPages).not.toHaveBeenCalled();
  });

  it("merges the checked assets in order", async () => {
    const host = provider();
    render(<PdfPageOpsPanel pages={[1]} provider={host} assetOptions={ASSETS} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Phụ lục A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Phụ lục B" }));
    fireEvent.click(screen.getByRole("button", { name: "Gộp tài liệu" }));
    await waitFor(() => expect(host.mergePdfs).toHaveBeenCalledWith({ assetIds: ["asset-a", "asset-b"] }));
  });

  it("splits with the chosen chunk size", async () => {
    const host = provider();
    render(<PdfPageOpsPanel pages={[1, 2, 3]} provider={host} />);
    fireEvent.change(screen.getByLabelText("Số trang mỗi phần"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Tách" }));
    await waitFor(() => expect(host.splitPdf).toHaveBeenCalledWith({ chunkSize: 2 }));
  });

  it("lists produced documents and skip warnings, and reports them", async () => {
    const documents: PdfNewDocument[] = [
      { op: "splitPdf", name: "tach-1", pageCount: 1, part: 1, bytes: Uint8Array.from([1]) },
      { op: "splitPdf", name: "tach-2", pageCount: 2, part: 2, bytes: Uint8Array.from([2]) },
    ];
    const host = provider({ splitPdf: vi.fn(async () => ({ documents, warnings: ["splitPdf #1: bỏ qua"] })) });
    const onDocuments = vi.fn();
    render(<PdfPageOpsPanel pages={[1, 2, 3]} provider={host} onDocuments={onDocuments} />);
    fireEvent.click(screen.getByRole("button", { name: "Tách" }));
    await waitFor(() => expect(screen.getByTestId("pdf-page-ops-result")).toBeInTheDocument());
    expect(screen.getByText("tach-1 · 1 trang")).toBeInTheDocument();
    expect(screen.getByText("splitPdf #1: bỏ qua")).toBeInTheDocument();
    expect(onDocuments).toHaveBeenCalledWith(documents, ["splitPdf #1: bỏ qua"]);
  });

  it("localizes a provider failure and disables the controls when read-only", async () => {
    const host = provider({ splitPdf: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "commit_failed" }); }) });
    const { rerender } = render(<PdfPageOpsPanel pages={[1, 2]} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Tách" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Không thể lưu tài liệu đã tạo."));

    rerender(<PdfPageOpsPanel pages={[1, 2]} provider={provider()} disabled />);
    expect(screen.getByRole("button", { name: "Tách" })).toBeDisabled();
  });
});
