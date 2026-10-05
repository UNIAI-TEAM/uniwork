import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfPrintButton } from "./pdf-print-button";
import { PdfPrintError } from "./types";

describe("PdfPrintButton", () => {
  it("prints the referenced surface through the injected port", async () => {
    const surface = document.createElement("div");
    const printSurface = vi.fn(async () => undefined);
    render(<PdfPrintButton surfaceRef={{ current: surface }} port={{ printSurface }} />);

    fireEvent.click(screen.getByRole("button", { name: "In" }));

    await waitFor(() => expect(printSurface).toHaveBeenCalledWith(surface));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the button disabled and busy while the host prints", async () => {
    let resolvePrint: () => void = () => undefined;
    const printSurface = vi.fn(() => new Promise<void>((resolve) => { resolvePrint = resolve; }));
    render(<PdfPrintButton surfaceRef={{ current: document.createElement("div") }} port={{ printSurface }} />);

    fireEvent.click(screen.getByRole("button", { name: "In" }));

    const busy = screen.getByRole("button", { name: "In" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveTextContent("Đang in…");

    resolvePrint();
    await waitFor(() => expect(screen.getByRole("button", { name: "In" })).toBeEnabled());
  });

  it("reports a failed print as an alert", async () => {
    const printSurface = vi.fn(() => {
      throw new PdfPrintError("failed");
    });
    render(<PdfPrintButton surfaceRef={{ current: document.createElement("div") }} port={{ printSurface }} />);

    fireEvent.click(screen.getByRole("button", { name: "In" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể in tài liệu.");
  });

  it("stays disabled when the editor is not ready", () => {
    render(<PdfPrintButton surfaceRef={{ current: null }} port={{ printSurface: vi.fn() }} disabled />);
    expect(screen.getByRole("button", { name: "In" })).toBeDisabled();
  });
});
