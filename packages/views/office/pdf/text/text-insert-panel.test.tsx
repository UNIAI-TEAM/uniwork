import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfTextInsertPanel } from "./text-insert-panel";
import type { PdfTextOperationProvider } from "./types";

const provider = (): PdfTextOperationProvider => ({ putTextEdit: vi.fn(), addTextInsert: vi.fn() });

describe("PdfTextInsertPanel", () => {
  it("submits an addTextInsert envelope with zero-based page coordinates", async () => {
    const host = provider();
    render(<PdfTextInsertPanel page={3} provider={host} origin={[72, 100]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "inserted" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(host.addTextInsert).toHaveBeenCalledWith({ pageIndex: 2, origin: [72, 100], text: "inserted", fontSize: 12, color: [0, 0, 0] }));
  });

  it("carries an insert-specific section label and its own input labels", () => {
    render(<PdfTextInsertPanel page={1} provider={provider()} />);
    expect(screen.getByRole("region", { name: "Chèn chữ" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Font" })).toHaveAttribute("placeholder", "Giữ font hiện tại");
    expect(screen.getByRole("spinbutton", { name: "Cỡ chữ" })).toBeInTheDocument();
  });

  it("clears the text once the insert applies", async () => {
    const host = provider();
    const onApplied = vi.fn();
    render(<PdfTextInsertPanel page={1} provider={host} onApplied={onApplied} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "inserted" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox", { name: "Chữ thay thế" })).toHaveValue("");
  });

  it("keeps apply disabled while the font size is not positive", () => {
    render(<PdfTextInsertPanel page={1} provider={provider()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "inserted" } });
    const apply = screen.getByRole("button", { name: "Áp dụng chữ" });
    expect(apply).toBeEnabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Cỡ chữ" }), { target: { value: "0" } });
    expect(apply).toBeDisabled();
  });

  it("reports a skipped insert instead of clearing the text", async () => {
    const host = provider();
    const onApplied = vi.fn();
    vi.mocked(host.addTextInsert).mockResolvedValueOnce({ warnings: [{ code: "edit_skipped", detail: "insert page=3: no available font" }] });
    render(<PdfTextInsertPanel page={3} provider={host} onApplied={onApplied} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "inserted" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Engine đã bỏ qua thay đổi này; tệp lưu không bao gồm nó."));
    expect(screen.getByRole("textbox", { name: "Chữ thay thế" })).toHaveValue("inserted");
    expect(onApplied).not.toHaveBeenCalled();
  });
});
