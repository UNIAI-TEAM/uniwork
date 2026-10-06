import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OfficePrintOutcome, OfficePrintPort } from "../../print";
import { OfficePrintShortcutScope } from "../../print/shortcut";
import type { PdfCanvasPage } from "../canvas";
import { PdfPrintButton, PdfPrintNotice } from "./pdf-print-button";
import { usePdfPrint, type PdfPrintController, type UsePdfPrintOptions } from "./use-pdf-print";
import { PRINT_PLATFORMS, pressPrintChord, stubPrintPlatform } from "../../../test/print-chord";

const pages: PdfCanvasPage[] = [{ pageNumber: 1, width: 595, height: 842, rotation: 0 }];
const renderer = { renderPage: vi.fn(async () => ({ src: "data:image/png;base64,AAAA", width: 1, height: 1 })) };

function options(port?: OfficePrintPort): UsePdfPrintOptions {
  return { port, renderer, getPages: () => pages, title: "Doc" };
}

function Harness({ port }: { port: OfficePrintPort }) {
  const controller = usePdfPrint(options(port)) as PdfPrintController;
  return (
    <>
      <PdfPrintButton controller={controller} />
      <PdfPrintNotice controller={controller} />
    </>
  );
}

describe("usePdfPrint", () => {
  it("offers no controller without a port, a renderer or pages", () => {
    expect(renderHook(() => usePdfPrint(options())).result.current).toBeNull();
    expect(renderHook(() => usePdfPrint({ ...options({ print: vi.fn() }), renderer: undefined })).result.current).toBeNull();
    expect(renderHook(() => usePdfPrint({ ...options({ print: vi.fn() }), getPages: undefined })).result.current).toBeNull();
    expect(renderHook(() => usePdfPrint(options({ print: vi.fn() }))).result.current).not.toBeNull();
  });

  it("ignores a second print while one runs and never retries by itself", async () => {
    let finish: (outcome: OfficePrintOutcome) => void = () => undefined;
    const print = vi.fn(() => new Promise<OfficePrintOutcome>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => usePdfPrint(options({ print })));

    act(() => { result.current?.print(); result.current?.print(); });
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await act(async () => { finish({ outcome: "failed", reason: "print_blocked" }); });

    await waitFor(() => expect(result.current?.printing).toBe(false));
    expect(print).toHaveBeenCalledTimes(1);
  });
});

/** Stands in for the Office shell, which owns the Ctrl/Cmd+P listener. */
function ShellScope({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref}><OfficePrintShortcutScope rootRef={ref}>{children}</OfficePrintShortcutScope></div>;
}

describe("PDF print on Ctrl/Cmd+P", () => {
  it.each(PRINT_PLATFORMS)("runs the same print as the entries and blocks the app window's print (%s)", async (platform) => {
    const restore = stubPrintPlatform(platform);
    try {
      const print = vi.fn(async (): Promise<OfficePrintOutcome> => ({ outcome: "printed" }));
      renderHook(() => usePdfPrint(options({ print })), { wrapper: ShellScope });
      expect(pressPrintChord(document.body)).toBe(false);
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  it("never prints a blank copy before any page is laid out", () => {
    const print = vi.fn();
    renderHook(() => usePdfPrint({ ...options({ print }), getPages: () => [] }), { wrapper: ShellScope });
    expect(pressPrintChord(document.body)).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });

  it("leaves Ctrl/Cmd+P to the platform without a port", () => {
    renderHook(() => usePdfPrint(options()), { wrapper: ShellScope });
    expect(pressPrintChord(document.body)).toBe(true);
  });
});

describe("PDF print entries", () => {
  it("prints through the injected port, disabled and busy while pages render", async () => {
    let finish: (outcome: OfficePrintOutcome) => void = () => undefined;
    const print = vi.fn(() => new Promise<OfficePrintOutcome>((resolve) => { finish = resolve; }));
    render(<Harness port={{ print }} />);

    fireEvent.click(screen.getByRole("button", { name: "In" }));

    const busy = screen.getByRole("button", { name: "In" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveTextContent("Đang in…");
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await act(async () => { finish({ outcome: "printed" }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "In" })).toBeEnabled());
    expect(screen.queryByTestId("pdf-print-error")).not.toBeInTheDocument();
  });

  it("stays silent when the dialog is cancelled", async () => {
    const print = vi.fn(async (): Promise<OfficePrintOutcome> => ({ outcome: "cancelled" }));
    render(<Harness port={{ print }} />);
    fireEvent.click(screen.getByRole("button", { name: "In" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "In" })).toBeEnabled());
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("pdf-print-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdf-print-busy")).not.toBeInTheDocument();
  });

  it("shows the neutral already-open status for print_busy", async () => {
    render(<Harness port={{ print: async () => ({ outcome: "failed", reason: "print_busy" }) }} />);
    fireEvent.click(screen.getByRole("button", { name: "In" }));
    expect(await screen.findByTestId("pdf-print-busy")).toHaveTextContent("Hộp thoại in đang mở");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the generic error for any other failure, and clears it on the next run", async () => {
    const print = vi.fn<OfficePrintPort["print"]>()
      .mockResolvedValueOnce({ outcome: "failed", reason: "print_blocked" })
      .mockResolvedValueOnce({ outcome: "printed" });
    render(<Harness port={{ print }} />);
    fireEvent.click(screen.getByRole("button", { name: "In" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể in tài liệu.");

    fireEvent.click(screen.getByRole("button", { name: "In" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows the shared too-large message when the copy exceeds the print cap", async () => {
    render(<Harness port={{ print: async () => ({ outcome: "failed", reason: "print_too_large" }) }} />);
    fireEvent.click(screen.getByRole("button", { name: "In" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tài liệu quá lớn để in.");
    expect(screen.getByTestId("pdf-print-error")).not.toHaveTextContent("Không thể in tài liệu.");
  });
});
