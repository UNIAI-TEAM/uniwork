import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { DropdownMenu, DropdownMenuContent } from "@uniwork/ui/components/ui/dropdown-menu";
import type { OfficePrintOutcome, OfficePrintPort } from "../../print";
import { OfficePrintShortcutScope } from "../../print/shortcut";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { runXlsxPrint, useXlsxPrint, type XlsxPrintOptions } from "./use-xlsx-print";

function host(): XlsxGridHostPort {
  return {
    file: {
      sessionId: "s-1",
      name: "Book.xlsx",
      sha256: "a",
      entryCount: 1,
      sheets: [{ id: "sheet-1", name: "Data", rowCount: 1, columnCount: 1, hidden: false, showGridLines: true, showFormulas: false, showRowColHeaders: true, rightToLeft: false, tabColor: null, defaultRowHeight: null, defaultRowHeightFixed: false, freeze: null, columnWidths: [], pivotTables: [], tables: [], comments: [], pivotRanges: [] }],
      styles: [],
      dxfStyles: [],
      visuals: [],
      definedNames: [],
      activeTab: 0,
      readOnly: false,
    },
    readRange: vi.fn(async () => ({ cells: [{ row: 0, column: 0, value: "hello" }], rows: [], merges: [] })),
  } as unknown as XlsxGridHostPort;
}

function portReturning(outcome: OfficePrintOutcome): OfficePrintPort {
  return { print: vi.fn(async () => outcome) };
}

function Harness(props: XlsxPrintOptions) {
  const wiring = useXlsxPrint(props);
  return (
    <>
      <DropdownMenu open>
        <DropdownMenuContent>{wiring.menuItem}</DropdownMenuContent>
      </DropdownMenu>
      <button type="button" data-testid="ribbon-print" disabled={!wiring.print} aria-busy={wiring.busy || undefined} onClick={() => wiring.print?.()}>print</button>
      {wiring.notice}
    </>
  );
}

const base = (port: OfficePrintPort | null | undefined): XlsxPrintOptions => ({ port, host: host(), sheetName: "Data", title: "Book" });

describe("useXlsxPrint", () => {
  it("prints from the header menu item and the ribbon through the same port", async () => {
    const port = portReturning({ outcome: "printed" });
    render(<Harness {...base(port)} />);
    fireEvent.click(screen.getByTestId("xlsx-header-print"));
    await waitFor(() => expect(port.print).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("ribbon-print"));
    await waitFor(() => expect(port.print).toHaveBeenCalledTimes(2));
    expect(vi.mocked(port.print).mock.calls[0]![0].html).toContain("hello");
    expect(screen.queryByTestId("xlsx-print-notice")).toBeNull();
  });

  it("offers no entry when the host cannot print", () => {
    render(<Harness {...base(null)} />);
    expect(screen.queryByTestId("xlsx-header-print")).toBeNull();
    expect(screen.getByTestId("ribbon-print")).toBeDisabled();
  });

  it("defaults to the browser port on web (undefined port)", () => {
    render(<Harness {...base(undefined)} />);
    expect(screen.getByTestId("xlsx-header-print")).toBeInTheDocument();
  });

  it("stays silent on cancel, shows the neutral status when busy, and the error otherwise", async () => {
    const cancelled = portReturning({ outcome: "cancelled" });
    const view = render(<Harness {...base(cancelled)} />);
    fireEvent.click(screen.getByTestId("ribbon-print"));
    await waitFor(() => expect(cancelled.print).toHaveBeenCalledOnce());
    expect(screen.queryByTestId("xlsx-print-notice")).toBeNull();
    view.unmount();

    const busy = portReturning({ outcome: "failed", reason: "print_busy" });
    const second = render(<Harness {...base(busy)} />);
    fireEvent.click(screen.getByTestId("ribbon-print"));
    expect(await screen.findByTestId("xlsx-print-notice")).toHaveAttribute("data-print-notice", "busy");
    second.unmount();

    const failed = portReturning({ outcome: "failed", reason: "print_blocked" });
    render(<Harness {...base(failed)} />);
    fireEvent.click(screen.getByTestId("ribbon-print"));
    expect(await screen.findByTestId("xlsx-print-notice")).toHaveAttribute("data-print-notice", "failed");
    expect(failed.print).toHaveBeenCalledOnce();
  });

  it("ignores a second request while one is pending", async () => {
    let resolve: (outcome: OfficePrintOutcome) => void = () => undefined;
    const port: OfficePrintPort = { print: vi.fn(() => new Promise<OfficePrintOutcome>((done) => { resolve = done; })) };
    render(<Harness {...base(port)} />);
    fireEvent.click(screen.getByTestId("ribbon-print"));
    await waitFor(() => expect(port.print).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByTestId("ribbon-print"));
    resolve({ outcome: "printed" });
    await waitFor(() => expect(port.print).toHaveBeenCalledOnce());
  });

  it("shows both entries busy while a run is pending (R1)", async () => {
    let resolve: (outcome: OfficePrintOutcome) => void = () => undefined;
    const port: OfficePrintPort = { print: vi.fn(() => new Promise<OfficePrintOutcome>((done) => { resolve = done; })) };
    render(<Harness {...base(port)} />);
    expect(screen.getByTestId("xlsx-header-print")).not.toHaveAttribute("aria-busy");
    fireEvent.click(screen.getByTestId("ribbon-print"));
    await waitFor(() => expect(screen.getByTestId("ribbon-print")).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByTestId("xlsx-header-print")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("xlsx-header-print")).toHaveAttribute("aria-disabled", "true");
    resolve({ outcome: "printed" });
    await waitFor(() => expect(screen.getByTestId("ribbon-print")).not.toHaveAttribute("aria-busy"));
  });

  it("shows the shared too-large message", async () => {
    render(<Harness {...base(portReturning({ outcome: "failed", reason: "print_too_large" }))} />);
    fireEvent.click(screen.getByTestId("ribbon-print"));
    const notice = await screen.findByTestId("xlsx-print-notice");
    expect(notice).toHaveAttribute("data-print-notice", "tooLarge");
    const shared = [en, viLocale].map((locale) => (locale as { office: { common: { printTooLarge: string } } }).office.common.printTooLarge);
    expect(shared).toContain(notice.textContent);
  });
});

function ShellScope({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref}><OfficePrintShortcutScope rootRef={ref}>{children}</OfficePrintShortcutScope></div>;
}

describe("useXlsxPrint Ctrl/Cmd+P", () => {
  it("runs the same print on Ctrl/Cmd+P and blocks the app window print", async () => {
    const port = portReturning({ outcome: "printed" });
    render(<ShellScope><Harness {...base(port)} /></ShellScope>);
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(false);
    await waitFor(() => expect(port.print).toHaveBeenCalledTimes(1));
    expect(fireEvent.keyDown(document.body, { key: "p", metaKey: true })).toBe(false);
    await waitFor(() => expect(port.print).toHaveBeenCalledTimes(2));
  });

  it("leaves Ctrl/Cmd+P alone when the host cannot print", () => {
    render(<ShellScope><Harness {...base(null)} /></ShellScope>);
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(true);
  });
});

describe("runXlsxPrint", () => {
  it("turns a too-large sheet and a throwing port into typed failures", async () => {
    const huge = host();
    (huge.file as { definedNames: unknown[] }).definedNames = [{ name: "_xlnm.Print_Area", formula: "Data!$A$1:$Z$100000", sheetIndex: 0 }];
    const port = portReturning({ outcome: "printed" });
    expect(await runXlsxPrint({ port, host: huge, sheetName: "Data", snapshot: null, title: "Book" })).toEqual({ outcome: "failed", reason: "print_too_large" });
    expect(port.print).not.toHaveBeenCalled();
    const throwing: OfficePrintPort = { print: () => { throw new Error("boom"); } };
    expect(await runXlsxPrint({ port: throwing, host: host(), sheetName: "Data", snapshot: null, title: "Book" })).toEqual({ outcome: "failed", reason: "boom" });
  });

  it("has every status string in both locales", () => {
    for (const locale of [en, viLocale]) {
      const print = (locale as { office: { xlsx: { print: Record<string, string> } } }).office.xlsx.print;
      expect(Object.keys(print).sort()).toEqual(["busy", "failed", "tooLarge"]);
    }
  });
});
