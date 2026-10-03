import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XlsxPageSetupDialog } from "./page-setup-dialog";

describe("XlsxPageSetupDialog", () => {
  it("applies the changed fields only", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<XlsxPageSetupDialog selection={{ sheet: "Data", address: "A1", endAddress: "C10" }} onApply={onApply} onClose={onClose} />);
    fireEvent.change(screen.getByTestId("xlsx-page-scale"), { target: { value: "75" } });
    fireEvent.click(screen.getByTestId("xlsx-page-setup-apply"));
    expect(onApply).toHaveBeenCalledWith({ scale: 75 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("refuses an all-keep form and an out-of-range number", () => {
    const onApply = vi.fn();
    render(<XlsxPageSetupDialog selection={{ sheet: "Data", address: "A1" }} onApply={onApply} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("xlsx-page-setup-apply"));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId("xlsx-page-setup-error")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("xlsx-page-scale"), { target: { value: "9" } });
    fireEvent.click(screen.getByTestId("xlsx-page-setup-apply"));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("sets print titles from the field and clears them with the checkbox", () => {
    const onApply = vi.fn();
    render(<XlsxPageSetupDialog selection={{ sheet: "Data", address: "A1" }} onApply={onApply} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("xlsx-page-print-titles"), { target: { value: "1:2" } });
    fireEvent.click(screen.getByTestId("xlsx-page-setup-apply"));
    expect(onApply).toHaveBeenCalledWith({ printTitles: "1:2" });
  });

  it("closes on cancel without applying", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<XlsxPageSetupDialog selection={null} onApply={onApply} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("xlsx-page-setup-cancel"));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
