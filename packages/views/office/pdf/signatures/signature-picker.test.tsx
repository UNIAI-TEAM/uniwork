import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock } from "../../../test/api-mock";
import { PdfSavedSignaturePicker } from "./signature-picker";

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const row = (over: Record<string, unknown> = {}) => ({ id: "s1", label: "Chữ ký của tôi", content_type: "image/png", image: "iVBORw0KGgo=", byte_size: 8, created_at: "2026-10-03T08:00:00Z", ...over });

function chooseFile(file: File) {
  fireEvent.change(screen.getByLabelText("Tệp ảnh chữ ký"), { target: { files: [file] } });
}
function typeName(value: string) {
  fireEvent.change(screen.getByLabelText("Tên chữ ký"), { target: { value } });
}

describe("PdfSavedSignaturePicker", () => {
  beforeEach(() => requestMock.mockReset());

  it("lists the caller's signatures with a thumbnail from the base64 image", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [row()] });
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    await screen.findByText("Chữ ký của tôi");
    const thumbnail = screen.getByTestId("pdf-signature-s1").querySelector("img");
    expect(thumbnail).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
  });

  it("shows the empty state when the caller has none", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [] });
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    expect(await screen.findByText("Chưa có chữ ký nào được lưu.")).toBeInTheDocument();
  });

  it("shows a loading state before the list lands", () => {
    requestMock.mockReturnValueOnce(new Promise(() => {}));
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    expect(screen.getByTestId("pdf-signature-loading")).toBeInTheDocument();
    expect(screen.getByText("Đang tải chữ ký…")).toBeInTheDocument();
  });

  it("shows an alert and a retry when the list fails", async () => {
    requestMock.mockRejectedValueOnce(new Error("down"));
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Không thể tải danh sách chữ ký. Thử lại.");
    requestMock.mockResolvedValueOnce({ signatures: [row()] });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Chữ ký của tôi")).toBeInTheDocument();
  });

  it("adds a signature from a PNG file with its label", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [] });
    requestMock.mockResolvedValueOnce({ signature: row() });
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    await screen.findByText("Chưa có chữ ký nào được lưu.");
    typeName("Ký nhanh");
    chooseFile(new File([PNG], "signature.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu chữ ký" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/orgs/o1/signatures",
        expect.objectContaining({ method: "POST", body: expect.objectContaining({ label: "Ký nhanh", content_type: "image/png" }) }),
      ),
    );
  });

  it("refuses a non-PNG/JPEG file with an alert and never posts", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [] });
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    await screen.findByText("Chưa có chữ ký nào được lưu.");
    typeName("Ký nhanh");
    chooseFile(new File([Uint8Array.from([1, 2, 3])], "note.pdf", { type: "application/pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu chữ ký" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chọn ảnh PNG hoặc JPEG.");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an image whose bytes do not match its declared type", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [] });
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    await screen.findByText("Chưa có chữ ký nào được lưu.");
    typeName("Ký nhanh");
    chooseFile(new File([Uint8Array.from([0xff, 0xd8, 0xff, 1])], "signature.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu chữ ký" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ảnh không khớp với định dạng đã khai báo.");
  });

  it("selects a signature through the callback", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [row()] });
    const onSelect = vi.fn();
    wrap(<PdfSavedSignaturePicker orgId="o1" onSelect={onSelect} />);
    await screen.findByText("Chữ ký của tôi");
    fireEvent.click(screen.getByRole("button", { name: "Chọn chữ ký: Chữ ký của tôi" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });

  it("marks the selected row pressed", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [row()] });
    wrap(<PdfSavedSignaturePicker orgId="o1" selectedId="s1" onSelect={vi.fn()} />);
    await screen.findByText("Chữ ký của tôi");
    expect(screen.getByRole("button", { name: "Chọn chữ ký: Chữ ký của tôi" })).toHaveAttribute("aria-pressed", "true");
  });

  it("deletes only after confirmation and keeps the row on failure", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [row()] });
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    await screen.findByText("Chữ ký của tôi");
    fireEvent.click(screen.getByRole("button", { name: "Xóa chữ ký: Chữ ký của tôi" }));
    const dialog = await screen.findByRole("alertdialog");
    requestMock.mockRejectedValueOnce(new Error("down"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa chữ ký" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Không thể xóa chữ ký. Thử lại."));
    expect(screen.getByText("Chữ ký của tôi")).toBeInTheDocument();
  });

  it("deletes a signature the server confirms", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [row()] });
    wrap(<PdfSavedSignaturePicker orgId="o1" />);
    await screen.findByText("Chữ ký của tôi");
    fireEvent.click(screen.getByRole("button", { name: "Xóa chữ ký: Chữ ký của tôi" }));
    const dialog = await screen.findByRole("alertdialog");
    requestMock.mockResolvedValueOnce({ status: "ok" });
    requestMock.mockResolvedValueOnce({ signatures: [] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa chữ ký" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/o1/signatures/s1", expect.objectContaining({ method: "DELETE" })));
  });

  it("disables every control in a read-only host", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [row()] });
    wrap(<PdfSavedSignaturePicker orgId="o1" onSelect={vi.fn()} disabled />);
    await screen.findByText("Chữ ký của tôi");
    expect(screen.getByLabelText("Tên chữ ký")).toBeDisabled();
    expect(screen.getByLabelText("Tệp ảnh chữ ký")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Lưu chữ ký" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chọn chữ ký: Chữ ký của tôi" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Xóa chữ ký: Chữ ký của tôi" })).toBeDisabled();
  });
});
