import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfSaveCopyButton } from "./pdf-save-copy-button";

describe("PdfSaveCopyButton", () => {
  it("downloads the host bytes under the copy filename", async () => {
    const download = vi.fn(async () => undefined);
    const onSaved = vi.fn();
    render(<PdfSaveCopyButton output={{ readOutputBytes: async () => Uint8Array.from([1, 2, 3]) }} fileBaseName="report" download={download} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Lưu bản sao" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("report.pdf"));
    expect(download).toHaveBeenCalledWith(expect.any(Uint8Array), "report.pdf");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still downloads when no onSaved callback is supplied", async () => {
    const download = vi.fn(async () => undefined);
    render(<PdfSaveCopyButton output={{ readOutputBytes: async () => Uint8Array.from([1]) }} download={download} />);

    fireEvent.click(screen.getByRole("button", { name: "Lưu bản sao" }));

    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Uint8Array), "document.pdf"));
  });

  it("stays disabled with an explanatory title while the host exposes no bytes", () => {
    render(<PdfSaveCopyButton />);
    const button = screen.getByRole("button", { name: "Lưu bản sao" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Chưa thể lưu bản sao.");
  });

  it("reports a failed copy as an alert", async () => {
    render(<PdfSaveCopyButton output={{ readOutputBytes: async () => { throw new Error("no bytes"); } }} download={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Lưu bản sao" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể lưu bản sao.");
  });
});
