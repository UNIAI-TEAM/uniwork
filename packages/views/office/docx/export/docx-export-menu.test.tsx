import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import type { DocxCommandRuntime } from "../commands";
import type { OfficePrintOutcome, OfficePrintPort } from "../../print";
import { chooseItem } from "../../../test/menu-interactions";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxExportGroup, docxExportRibbonItems } from "./docx-export-menu";
import { DocxPrintMenuItem, DocxPrintNotice, runDocxPrint } from "./docx-print-entry";
import { createDocxDocumentScope, DocxDocumentScopeProvider, type DocxDocumentScope } from "../editor-store";
import { emptyHeaderFooterState } from "../header-footer/header-footer-state";

const COPY = "<!DOCTYPE html><html><body><section>copy</section></body></html>";

function runtime(): DocxCommandRuntime {
  return {
    docxExportReady: true,
    getState: vi.fn(() => ({ docxPageSetup: null, docxHeaderFooter: null })),
    docxPrintHeaderFooterSource: vi.fn(() => null),
    listDocxHeaderFooterEdits: vi.fn(() => []),
    buildDocxPrintCopy: vi.fn(() => COPY),
    exportDocxHtml: vi.fn(() => "<html></html>"),
    downloadDocxHtml: vi.fn(() => true),
  } as unknown as DocxCommandRuntime;
}

function port(outcome: OfficePrintOutcome = { outcome: "printed" }) {
  return { print: vi.fn<OfficePrintPort["print"]>(async () => outcome) };
}

function context(options: { commands?: DocxCommandRuntime; ready?: boolean; port?: OfficePrintPort; docScope?: DocxDocumentScope } = {}): DocxToolbarGroupContext {
  const commands = "commands" in options ? options.commands : runtime();
  return {
    docScope: options.docScope ?? createDocxDocumentScope(),
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: { docxExportReady: options.ready ?? true } as unknown as DocxToolbarGroupContext["format"],
    commands,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...(options.port ? { print: { port: options.port, title: "Hợp đồng" } } : {}),
  };
}

function renderGroup(options: Parameters<typeof context>[0] = {}) {
  const props = context(options);
  render(
    <>
      <DocxExportGroup {...props} />
      <DocxDocumentScopeProvider scope={props.docScope}>
        <DocxPrintNotice />
      </DocxDocumentScopeProvider>
    </>,
  );
  return { commands: props.commands };
}

async function openMenu() {
  fireEvent.click(screen.getByTestId("docx-export-menu"));
  return screen.findByRole("menu");
}

describe("DocxExportGroup", () => {
  it("disables the entry without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-export-menu")).toBeDisabled();
  });

  it("disables the entry while no document is open", () => {
    renderGroup({ ready: false });
    expect(screen.getByTestId("docx-export-menu")).toBeDisabled();
  });

  it("prints the document copy through the injected port", async () => {
    const printPort = port();
    const { commands } = renderGroup({ port: printPort });
    const menu = await openMenu();
    await chooseItem(menu, "In", "mouse");
    await waitFor(() => expect(printPort.print).toHaveBeenCalledWith({ html: COPY, title: "Hợp đồng" }));
    expect(commands?.buildDocxPrintCopy).toHaveBeenCalledWith({ title: "Hợp đồng", sections: null, headerFooter: null });
    expect(screen.queryByTestId("docx-print-notice")).toBeNull();
  });

  it("prints the per-section headers and footers with the pending edits applied", async () => {
    const printPort = port();
    const commands = runtime();
    const part = (id: string, text: string) => ({ id, text, pageNumber: false, images: [] });
    const section = (index: number, text: string) => ({
      index,
      titlePg: false,
      header: { default: part(`rId${index}`, text), first: null, even: null },
      footer: { default: null, first: null, even: null },
    });
    const state = emptyHeaderFooterState();
    state.slots.header = { value: { text: "Đã sửa" }, hasImages: false };
    Object.assign(commands, {
      getState: vi.fn(() => ({ docxPageSetup: null, docxHeaderFooter: state })),
      docxPrintHeaderFooterSource: vi.fn(() => ({ evenAndOddHeaders: false, sections: [section(0, "Phần 1"), section(1, "Phần 2")] })),
      listDocxHeaderFooterEdits: vi.fn(() => [{ op: "set_header_footer", slot: "header", hf: { text: "Đã sửa" } }]),
    });
    await runDocxPrint({ commands, print: { port: printPort, title: "Hợp đồng" }, docScope: createDocxDocumentScope() });
    const options = vi.mocked(commands.buildDocxPrintCopy).mock.calls[0]?.[0];
    expect(options?.headerFooter?.sections.map((entry) => entry.header.default?.text)).toEqual(["Phần 1", "Đã sửa"]);
    expect(printPort.print).toHaveBeenCalledTimes(1);
  });

  it("offers no Print entry when the host injected no port", async () => {
    renderGroup();
    const menu = await openMenu();
    expect(within(menu).queryByRole("menuitem", { name: "In" })).toBeNull();
    expect(docxExportRibbonItems(context())[0]).toMatchObject({ kind: "dropdown" });
    const items = (docxExportRibbonItems(context())[0] as unknown as { menu: Array<{ id: string }> }).menu.map((item) => item.id);
    expect(items).toEqual(["export-html", "export-pdf"]);
  });

  it("binds the ribbon Print item to the same port", async () => {
    const printPort = port();
    const items = (docxExportRibbonItems(context({ port: printPort }))[0] as unknown as { menu: Array<{ id: string; onSelect: () => void }> }).menu;
    expect(items.map((item) => item.id)).toEqual(["export-print", "export-html", "export-pdf"]);
    items[0]?.onSelect();
    await waitFor(() => expect(printPort.print).toHaveBeenCalledTimes(1));
  });

  it("downloads the standalone HTML from the menu", async () => {
    const { commands } = renderGroup();
    const menu = await openMenu();
    await chooseItem(menu, "Xuất HTML", "mouse");
    expect(commands?.downloadDocxHtml).toHaveBeenCalledWith("tài liệu", "Tài liệu");
  });

  it("opens the PDF guidance dialog and routes its print action to the port", async () => {
    const printPort = port();
    renderGroup({ port: printPort });
    const menu = await openMenu();
    await chooseItem(menu, "Xuất PDF", "mouse");
    expect(screen.getByTestId("docx-export-pdf-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("docx-export-pdf-print"));
    await waitFor(() => expect(printPort.print).toHaveBeenCalledTimes(1));
  });

  it("shows no dead Print button in the PDF dialog without a port", async () => {
    renderGroup();
    const menu = await openMenu();
    await chooseItem(menu, "Xuất PDF", "mouse");
    expect(screen.getByTestId("docx-export-pdf-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-export-pdf-print")).toBeNull();
  });

  it("shows the neutral already-open status for print_busy", async () => {
    renderGroup({ port: port({ outcome: "failed", reason: "print_busy" }) });
    const menu = await openMenu();
    await chooseItem(menu, "In", "mouse");
    const notice = await screen.findByTestId("docx-print-notice");
    expect(notice).toHaveAttribute("data-print-notice", "busy");
    expect(notice).toHaveTextContent("Hộp thoại in đang mở");
  });

  it("shows the generic error for any other failure and stays silent on cancel", async () => {
    renderGroup({ port: port({ outcome: "failed", reason: "print_call_failed" }) });
    const menu = await openMenu();
    await chooseItem(menu, "In", "mouse");
    expect(await screen.findByTestId("docx-print-notice")).toHaveAttribute("data-print-notice", "failed");
  });

  it("shows a print outcome only in the document that printed (UNI-957)", async () => {
    const a = context({ port: port({ outcome: "failed", reason: "print_call_failed" }) });
    const b = createDocxDocumentScope();
    render(
      <>
        <div data-testid="doc-a">
          <DocxDocumentScopeProvider scope={a.docScope}>
            <DocxPrintNotice />
          </DocxDocumentScopeProvider>
        </div>
        <div data-testid="doc-b">
          <DocxDocumentScopeProvider scope={b}>
            <DocxPrintNotice />
          </DocxDocumentScopeProvider>
        </div>
      </>,
    );
    await act(async () => {
      await runDocxPrint(a);
    });
    expect(within(screen.getByTestId("doc-a")).getByTestId("docx-print-notice")).toHaveAttribute("data-print-notice", "failed");
    expect(within(screen.getByTestId("doc-b")).queryByTestId("docx-print-notice")).toBeNull();
  });

  it("stays silent when the dialog is cancelled", async () => {
    const printPort = port({ outcome: "cancelled" });
    renderGroup({ port: printPort });
    const menu = await openMenu();
    await chooseItem(menu, "In", "mouse");
    await waitFor(() => expect(printPort.print).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByTestId("docx-print-notice")).toBeNull();
  });
});

describe("runDocxPrint", () => {
  it("ignores a second request on a port that still has a job open", async () => {
    let settle: (outcome: OfficePrintOutcome) => void = () => undefined;
    const slow = { print: vi.fn<OfficePrintPort["print"]>(() => new Promise<OfficePrintOutcome>((resolve) => { settle = resolve; })) };
    const base = context({ port: slow });
    const first = runDocxPrint(base);
    await waitFor(() => expect(slow.print).toHaveBeenCalledTimes(1));
    await runDocxPrint(base);
    expect(slow.print).toHaveBeenCalledTimes(1);
    settle({ outcome: "printed" });
    await first;
    // The job settled, so the port is free again.
    const again = runDocxPrint(base);
    await waitFor(() => expect(slow.print).toHaveBeenCalledTimes(2));
    settle({ outcome: "printed" });
    await again;
  });

  it("does not let one port's open job block another port", async () => {
    const stuck = { print: vi.fn<OfficePrintPort["print"]>(() => new Promise<OfficePrintOutcome>(() => undefined)) };
    const other = port();
    void runDocxPrint(context({ port: stuck }));
    await waitFor(() => expect(stuck.print).toHaveBeenCalledTimes(1));
    await runDocxPrint(context({ port: other }));
    expect(other.print).toHaveBeenCalledTimes(1);
  });
});

describe("DocxPrintMenuItem", () => {
  function renderItem(props: Parameters<typeof DocxPrintMenuItem>[0]) {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="header-menu">⋯</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DocxPrintMenuItem {...props} />
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByTestId("header-menu"));
  }

  it("prints from the page header menu through the same action", async () => {
    const printPort = port();
    renderItem({ commands: runtime(), print: { port: printPort, title: "Doc" }, docScope: createDocxDocumentScope(), ready: true });
    const menu = await screen.findByRole("menu");
    await chooseItem(menu, "In", "mouse");
    await waitFor(() => expect(printPort.print).toHaveBeenCalledWith({ html: COPY, title: "Doc" }));
  });

  it("is disabled until a document is open", async () => {
    renderItem({ commands: runtime(), print: { port: port(), title: "Doc" }, docScope: createDocxDocumentScope(), ready: false });
    await screen.findByRole("menu");
    expect(screen.getByTestId("docx-header-print")).toHaveAttribute("aria-disabled", "true");
  });
});
