/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setLocale } from "@uniwork/core/i18n";
import i18n from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopPrintOptionsSchema, desktopPrintSavePdfRequestSchema, PRINT_HTML_MAX_BYTES } from "../../../shared/ipc-print";
import type { PrintPreviewBridge, PrintPreviewChoice, PrintPreviewHook, PrintPreviewJob } from "./types";
import { PREVIEW_BUSY_RETRY_MS, PREVIEW_DEBOUNCE_MS } from "./use-print-data";
import { usePrintPreview } from "./use-print-preview";

const tp = (key: string, options?: Record<string, unknown>): string => i18n.t(`officeDesktop.print.${key}`, options);

const job: PrintPreviewJob = { title: "Report.docx", html: "<!DOCTYPE html><html><body><p>x</p></body></html>", geometry: { landscape: false, pageSize: { width: 210_000, height: 297_000 } } };
const PRINTERS = [
  { name: "Office Laser", displayName: "Office Laser", isDefault: false, needsSystemDialog: false },
  { name: "Front Desk", displayName: "Front Desk", isDefault: true, needsSystemDialog: false },
];
/** A stock queue whose port prompts (file name, fax number): a silent job there would fail. */
const PDF_QUEUE = { name: "Microsoft Print to PDF", displayName: "Microsoft Print to PDF", isDefault: false, needsSystemDialog: true };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

interface Call { channel: string; payload: Record<string, unknown> & { operation?: string; args?: Record<string, unknown>; options?: Record<string, unknown> } }
interface FakeOptions {
  pageCount?: number;
  printers?: unknown;
  printersReject?: boolean;
  /** The n-th (1-based) `desktop:print-preview` answer. */
  preview?: (n: number) => unknown | Promise<unknown>;
}

function fakeBridge(options: FakeOptions = {}) {
  const calls: Call[] = [];
  let previews = 0;
  let handles = 0;
  // Like main: one layout at a time, a second request meanwhile is turned away.
  let laying = false;
  const call = vi.fn(async (channel: string, payload: Call["payload"]): Promise<unknown> => {
    calls.push({ channel, payload });
    if (channel === "desktop:print-printers") {
      if (options.printersReject) throw new Error("no printers");
      return { printers: options.printers ?? PRINTERS };
    }
    if (channel === "desktop:print-preview") {
      previews += 1;
      if (laying) return { outcome: "failed", reason: "print_busy" };
      laying = true;
      try {
        return options.preview ? await options.preview(previews) : { outcome: "ready", pdf: PDF };
      } finally {
        laying = false;
      }
    }
    if (payload.operation === "open") return { ok: true, probe: { pageCount: options.pageCount ?? 3 }, pdfHandle: `handle-${++handles}` };
    if (payload.operation === "render") return { ok: true, pngBase64: "AAAA", width: 300, height: 400 };
    return { ok: true };
  });
  const of = (channel: string): Call[] => calls.filter((entry) => entry.channel === channel);
  const engine = (operation: string): Call[] => of("desktop:engine-call").filter((entry) => entry.payload.operation === operation);
  return { bridge: { call } as unknown as PrintPreviewBridge, call, calls, of, engine };
}

type Hook = ReturnType<typeof usePrintPreview>;
function Harness({ bridge, onHook }: { bridge: PrintPreviewBridge | undefined; onHook(hook: Hook): void }) {
  const hook = usePrintPreview(bridge);
  onHook(hook);
  return <>{hook.dialog}</>;
}

/** Mount the hook and open one dialog; `choice` settles when the dialog closes. */
async function openDialog(bridge: PrintPreviewBridge | "none" | "fake" = "fake") {
  const used = bridge === "fake" ? fakeBridge().bridge : bridge === "none" ? undefined : bridge;
  let hook!: Hook;
  const view = render(<Harness bridge={used} onHook={(next) => { hook = next; }} />);
  let choice!: Promise<PrintPreviewChoice>;
  const settled = vi.fn();
  act(() => { choice = hook.preview(job); void choice.then(settled); });
  return { view, choice, settled, hook: () => hook };
}

const dialogEl = (): HTMLElement => screen.getByRole("dialog");
const printButton = (): HTMLElement => within(dialogEl()).getByRole("button", { name: tp("print") });
const saveButton = (): HTMLElement => within(dialogEl()).getByRole("button", { name: tp("save") });
const destinationSelect = (): HTMLElement => within(dialogEl()).getByRole("combobox", { name: tp("printer") });
const radio = (key: string): HTMLElement => within(dialogEl()).getByRole("radio", { name: tp(key) });
/** jsdom does not turn a click on Base UI's radio span into a change; a click on its label does, like a real one. */
const choose = (key: string): void => { fireEvent.click(radio(key).closest("label")!); };
/** Open a Base UI select and pick one option the way the repo's other tests do. */
const pick = async (name: string, option: string): Promise<void> => {
  fireEvent.click(within(dialogEl()).getByRole("combobox", { name }));
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.pointerUp(item, { pointerType: "mouse" });
  fireEvent.click(item);
};
const pages = async (count: number): Promise<HTMLElement[]> => {
  await waitFor(() => expect(screen.getAllByTestId("print-preview-page")).toHaveLength(count));
  return screen.getAllByTestId("print-preview-page");
};

afterEach(() => { vi.useRealTimers(); });

describe("usePrintPreview", () => {
  it("renders no dialog until a job is opened, then closes it and resolves the choice", async () => {
    const { bridge } = fakeBridge();
    let hook!: Hook;
    render(<Harness bridge={bridge} onHook={(next) => { hook = next; }} />);
    expect(hook.dialog).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    let choice!: Promise<PrintPreviewChoice>;
    act(() => { choice = hook.preview(job); });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("cancel") }));
    await expect(choice).resolves.toEqual({ kind: "cancel" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(hook.dialog).toBeNull();
  });

  it("answers a second job while one dialog is open with cancel and leaves the open dialog alone", async () => {
    const { choice, settled, hook } = await openDialog();
    await screen.findByRole("dialog");
    let second!: Promise<PrintPreviewChoice>;
    act(() => { second = hook().preview({ ...job, title: "Other.docx" }); });
    await expect(second).resolves.toEqual({ kind: "cancel" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(settled).not.toHaveBeenCalled();
    fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("systemDialog") }));
    await expect(choice).resolves.toEqual({ kind: "system" });
  });

  it("falls back to the system dialog without a bridge", async () => {
    const { choice } = await openDialog("none");
    await expect(choice).resolves.toEqual({ kind: "system" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves an open dialog as cancel when the host unmounts", async () => {
    const { choice, view } = await openDialog();
    await screen.findByRole("dialog");
    view.unmount();
    await expect(choice).resolves.toEqual({ kind: "cancel" });
  });

  it("keeps the same preview function while the bridge is the same", async () => {
    const { bridge } = fakeBridge();
    const seen = new Set<PrintPreviewHook>();
    const view = render(<Harness bridge={bridge} onHook={(hook) => seen.add(hook.preview)} />);
    view.rerender(<Harness bridge={bridge} onHook={(hook) => seen.add(hook.preview)} />);
    expect(seen.size).toBe(1);
  });
});

describe("the dialog's preview", () => {
  it("names the document in the title and lays the copy out through the print and engine channels", async () => {
    const fake = fakeBridge({ pageCount: 3 });
    await openDialog(fake.bridge);
    expect(await screen.findByRole("dialog", { name: tp("title", { title: "Report.docx" }) })).toBeInTheDocument();
    expect(dialogEl().textContent).not.toMatch(/electron/i);
    await pages(3);
    expect(await screen.findAllByRole("img")).toHaveLength(3);
    expect(within(dialogEl()).getByText(tp("pageCount", { count: 3 }))).toBeInTheDocument();

    expect(fake.of("desktop:print-preview")).toHaveLength(1);
    expect(fake.of("desktop:print-preview")[0]!.payload).toEqual({ sessionGeneration: "desktop-dev-session", title: "Report.docx", html: job.html, options: job.geometry });
    const open = fake.engine("open")[0]!;
    expect(open.payload).toMatchObject({ sessionGeneration: "desktop-dev-session", handle: "print-preview", args: { retain: true, surface: expect.stringMatching(/^pp_/) } });
    expect(open.payload.args!.data).toBeInstanceOf(Uint8Array);
    const render0 = fake.engine("render").find((entry) => entry.payload.args!.pageIndex === 0)!;
    expect(render0.payload.args).toMatchObject({ pdfHandle: "handle-1", pageIndex: 0, scale: expect.any(Number), surface: open.payload.args!.surface });
    expect(render0.payload.args!.scale).toBeLessThanOrEqual(1);
    expect(screen.getAllByRole("img")[0]).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("brands the title with the product name, never Electron, in both languages", async () => {
    await openDialog();
    expect(await screen.findByRole("dialog", { name: "In “Report.docx” – UniWork Office" })).toBeInTheDocument();
    await pages(3);
    await setLocale("en");
    expect(i18n.t("officeDesktop.print.title", { title: "Report.docx" })).toBe("Print “Report.docx” – UniWork Office");
  });

  it("calls the page choice the page shown in the preview, not the editor's current page", async () => {
    await openDialog();
    await pages(3);
    expect(radio("rangeCurrent")).toHaveAccessibleName("Trang đang xem");
    await setLocale("en");
    expect(i18n.t("officeDesktop.print.rangeCurrent")).toBe("Page shown");
  });

  it("is busy while the first layout is prepared, and says so", async () => {
    let release!: (value: unknown) => void;
    const fake = fakeBridge({ preview: () => new Promise((resolve) => { release = resolve; }) });
    await openDialog(fake.bridge);
    const section = await screen.findByRole("region", { name: tp("preview") });
    expect(section).toHaveAttribute("aria-busy", "true");
    expect(within(section).getByText(tp("previewPreparing"))).toBeInTheDocument();
    await act(async () => { release({ outcome: "ready", pdf: PDF }); });
    await pages(3);
    await waitFor(() => expect(section).toHaveAttribute("aria-busy", "false"));
  });

  it("announces the page number only for the previous and next buttons, not for every scroll step", async () => {
    await openDialog(fakeBridge({ pageCount: 3 }).bridge);
    await pages(3);
    const section = within(dialogEl()).getByRole("region", { name: tp("preview") });
    const live = section.querySelector("[aria-live]") as HTMLElement;
    expect(live).not.toBeNull();
    expect(live).toHaveClass("sr-only");
    // The visible "Trang x / y" is not itself a live region.
    expect(within(section).getByText(tp("pageOf", { current: 1, total: 3 })).closest("[aria-live]")).toBeNull();
    expect(live.textContent).toBe("");
    fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("nextPage") }));
    expect(live.textContent).toBe(tp("pageOf", { current: 2, total: 3 }));
  });

  it("steps through the pages with the previous and next buttons", async () => {
    await openDialog(fakeBridge({ pageCount: 3 }).bridge);
    await pages(3);
    const prev = within(dialogEl()).getByRole("button", { name: tp("previousPage") });
    const next = within(dialogEl()).getByRole("button", { name: tp("nextPage") });
    expect(within(dialogEl()).getAllByText(tp("pageOf", { current: 1, total: 3 }))[0]).toBeInTheDocument();
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(within(dialogEl()).getAllByText(tp("pageOf", { current: 2, total: 3 }))[0]).toBeInTheDocument();
    expect(screen.getAllByTestId("print-preview-page")[1]).toHaveAttribute("aria-current", "page");
    fireEvent.click(next);
    expect(next).toBeDisabled();
    fireEvent.click(prev);
    expect(within(dialogEl()).getAllByText(tp("pageOf", { current: 2, total: 3 }))[0]).toBeInTheDocument();
  });
});

describe("what Print sends", () => {
  it("prints silently to the default printer with the document's own geometry", async () => {
    const { choice } = await openDialog();
    await pages(3);
    fireEvent.click(printButton());
    const result = await choice;
    expect(result).toEqual({ kind: "print", options: { landscape: false, pageSize: job.geometry.pageSize, silent: true, deviceName: "Front Desk", copies: 1 } });
    if (result.kind !== "print") throw new Error("expected print");
    // Untouched colour and duplex stay the printer's own: the keys are not sent at all.
    expect("color" in result.options || "duplexMode" in result.options || "pageRanges" in result.options).toBe(false);
    expect(desktopPrintOptionsSchema.safeParse(result.options).success).toBe(true);
  });

  it("opens on the document's own orientation", async () => {
    const landscape = { ...job, geometry: { landscape: true, pageSize: { width: 190_500, height: 338_667 } } };
    const fake = fakeBridge();
    let hook!: Hook;
    render(<Harness bridge={fake.bridge} onHook={(next) => { hook = next; }} />);
    let choice!: Promise<PrintPreviewChoice>;
    act(() => { choice = hook.preview(landscape); });
    await screen.findByRole("dialog");
    expect(radio("landscape")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(fake.of("desktop:print-preview")[0]!.payload.options).toEqual(landscape.geometry));
    fireEvent.click(printButton());
    await expect(choice).resolves.toMatchObject({ kind: "print", options: { landscape: true, pageSize: { width: 190_500, height: 338_667 } } });
  });

  it("carries copies, colour, a custom page range and the paper through the wire schema", async () => {
    const { choice } = await openDialog();
    await pages(3);
    fireEvent.change(within(dialogEl()).getByLabelText(tp("copies")), { target: { value: "12" } });
    choose("colorMono");
    choose("rangeCustom");
    fireEvent.change(within(dialogEl()).getByLabelText(tp("rangeCustomLabel")), { target: { value: "1-2, 3" } });
    await waitFor(() => expect(printButton()).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(printButton());
    const result = await choice;
    if (result.kind !== "print") throw new Error("expected print");
    expect(result.options).toMatchObject({ silent: true, deviceName: "Front Desk", copies: 12, color: false, pageRanges: [{ from: 0, to: 1 }, { from: 2, to: 2 }] });
    expect(desktopPrintOptionsSchema.parse(result.options)).toEqual(result.options);
  });

  it("prints just the page the preview shows for the current-page choice", async () => {
    const { choice } = await openDialog();
    await pages(3);
    fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("nextPage") }));
    choose("rangeCurrent");
    fireEvent.click(printButton());
    await expect(choice).resolves.toMatchObject({ kind: "print", options: { pageRanges: [{ from: 1, to: 1 }] } });
  });

  it("turns the sheet with the orientation choice", async () => {
    const { choice } = await openDialog();
    await pages(3);
    choose("landscape");
    fireEvent.click(printButton());
    await expect(choice).resolves.toMatchObject({ kind: "print", options: { landscape: true, pageSize: job.geometry.pageSize } });
  });

  it("refuses a bad page range and shows why, until it is fixed", async () => {
    const { choice } = await openDialog();
    await pages(3);
    choose("rangeCustom");
    const input = within(dialogEl()).getByLabelText(tp("rangeCustomLabel"));
    for (const bad of ["3-1", "0", "", "1-"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(printButton()).toHaveAttribute("aria-disabled", "true");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(within(dialogEl()).getByText(tp("rangeSyntax"))).toBeInTheDocument();
    }
    fireEvent.change(input, { target: { value: "2-9" } });
    expect(printButton()).toHaveAttribute("aria-disabled", "true");
    expect(within(dialogEl()).getByText(tp("rangeBounds", { count: 3 }))).toBeInTheDocument();
    fireEvent.click(printButton());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "2-3" } });
    expect(printButton()).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(printButton());
    await expect(choice).resolves.toMatchObject({ kind: "print", options: { pageRanges: [{ from: 1, to: 2 }] } });
  });

  it("refuses copies outside 1..999", async () => {
    await openDialog();
    await pages(3);
    const copies = within(dialogEl()).getByLabelText(tp("copies"));
    for (const bad of ["0", "1000", ""]) {
      fireEvent.change(copies, { target: { value: bad } });
      expect(copies).toHaveAttribute("aria-invalid", "true");
      expect(within(dialogEl()).getByText(tp("copiesInvalid"))).toBeInTheDocument();
      expect(printButton()).toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.change(copies, { target: { value: "999" } });
    expect(copies).not.toHaveAttribute("aria-invalid", "true");
    expect(printButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("opens colour and duplex on the printer default and sends a choice only once it is made", async () => {
    const { choice } = await openDialog();
    await pages(3);
    expect(radio("colorDefault")).toHaveAttribute("aria-checked", "true");
    expect(within(dialogEl()).getByRole("combobox", { name: tp("duplex") })).toHaveTextContent(tp("duplexDefault"));
    choose("colorColor");
    await pick(tp("duplex"), tp("duplexSimplex"));
    fireEvent.click(printButton());
    const result = await choice;
    if (result.kind !== "print") throw new Error("expected print");
    expect(result.options).toMatchObject({ color: true, duplexMode: "simplex" });
    expect(desktopPrintOptionsSchema.parse(result.options)).toEqual(result.options);
  });

  it("picks another printer and a duplex mode from the lists", async () => {
    const { choice } = await openDialog();
    await pages(3);
    await pick(tp("printer"), "Office Laser");
    await pick(tp("duplex"), tp("duplexShortEdge"));
    fireEvent.click(printButton());
    await expect(choice).resolves.toMatchObject({ kind: "print", options: { deviceName: "Office Laser", duplexMode: "shortEdge" } });
  });
});

describe("the other choices and focus", () => {
  it("resolves the system dialog from its link", async () => {
    const { choice } = await openDialog();
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: tp("systemDialog") }));
    await expect(choice).resolves.toEqual({ kind: "system" });
  });

  it("resolves cancel on Esc, and the dialog holds focus until then", async () => {
    const { choice, settled } = await openDialog();
    await pages(3);
    expect(dialogEl().contains(document.activeElement)).toBe(true);
    // Focus pushed out is pulled back by the trap.
    act(() => { document.body.focus(); });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    expect(dialogEl().contains(document.activeElement) || document.activeElement === document.body).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await expect(choice).resolves.toEqual({ kind: "cancel" });
  });

  it("does not cancel on a click outside the dialog", async () => {
    const { settled } = await openDialog();
    await pages(3);
    fireEvent.pointerDown(document.body, { button: 0 });
    fireEvent.click(document.body);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(settled).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("printers", () => {
  it("offers Save as PDF, the system dialog and cancel, but no Print, when there is no printer", async () => {
    const { choice } = await openDialog(fakeBridge({ printers: [] }).bridge);
    expect(await within(await screen.findByRole("dialog")).findByText(tp("printersEmpty"))).toBeInTheDocument();
    expect(within(dialogEl()).queryByRole("button", { name: tp("print") })).toBeNull();
    expect(saveButton()).toBeInTheDocument();
    expect(destinationSelect()).toHaveTextContent(tp("savePdf"));
    expect(within(dialogEl()).getByRole("button", { name: tp("cancel") })).toBeInTheDocument();
    fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("systemDialog") }));
    await expect(choice).resolves.toEqual({ kind: "system" });
  });

  it("says so when the printer list cannot be read, and still saves a PDF", async () => {
    const { choice } = await openDialog(fakeBridge({ printersReject: true }).bridge);
    expect(await within(await screen.findByRole("dialog")).findByText(tp("printersError"))).toBeInTheDocument();
    expect(within(dialogEl()).queryByRole("button", { name: tp("print") })).toBeNull();
    expect(within(dialogEl()).getByRole("button", { name: tp("systemDialog") })).toBeInTheDocument();
    await pages(3);
    fireEvent.click(saveButton());
    await expect(choice).resolves.toEqual({ kind: "save-pdf", options: { landscape: false, pageSize: job.geometry.pageSize } });
  });

  it("treats a reply that is not a printer list as an error", async () => {
    await openDialog(fakeBridge({ printers: "nope" as unknown }).bridge);
    expect(await within(await screen.findByRole("dialog")).findByText(tp("printersError"))).toBeInTheDocument();
  });

  it("cannot print while the list is still loading", async () => {
    let release!: (value: unknown) => void;
    const calls: string[] = [];
    const bridge = { call: vi.fn((channel: string) => { calls.push(channel); return channel === "desktop:print-printers" ? new Promise((resolve) => { release = resolve; }) : new Promise(() => undefined); }) } as unknown as PrintPreviewBridge;
    await openDialog(bridge);
    expect(await within(await screen.findByRole("dialog")).findByText(tp("printerLoading"))).toBeInTheDocument();
    expect(within(dialogEl()).queryByRole("button", { name: tp("print") })).toBeNull();
    await act(async () => { release({ printers: PRINTERS }); });
    expect(await within(dialogEl()).findByRole("button", { name: tp("print") })).toBeInTheDocument();
  });
});

describe("destinations", () => {
  const optionNames = (): string[] => screen.getAllByRole("option").map((option) => option.textContent ?? "");
  const savePdfOptions = (choice: PrintPreviewChoice) => {
    if (choice.kind !== "save-pdf") throw new Error("expected save-pdf");
    expect(desktopPrintSavePdfRequestSchema.shape.options.parse(choice.options)).toEqual(choice.options);
    return choice.options;
  };

  it("lists Save as PDF first, ahead of every printer, and keeps the default printer selected", async () => {
    await openDialog();
    await pages(3);
    expect(destinationSelect()).toHaveTextContent("Front Desk");
    fireEvent.click(destinationSelect());
    await screen.findAllByRole("option");
    expect(optionNames()).toEqual([tp("savePdf"), tp("printerDefault", { name: "Front Desk" }), "Office Laser"]);
    expect(within(dialogEl()).queryByRole("button", { name: tp("save") })).toBeNull();
  });

  it("preselects Save as PDF when the default printer needs the system dialog", async () => {
    const { choice } = await openDialog(fakeBridge({ printers: [{ ...PDF_QUEUE, isDefault: true }, ...PRINTERS.map((printer) => ({ ...printer, isDefault: false }))] }).bridge);
    await pages(3);
    expect(destinationSelect()).toHaveTextContent(tp("savePdf"));
    expect(within(dialogEl()).getByText(tp("savePdfNote"))).toBeInTheDocument();
    expect(within(dialogEl()).queryByRole("button", { name: tp("print") })).toBeNull();
    fireEvent.click(saveButton());
    expect(savePdfOptions(await choice)).toEqual({ landscape: false, pageSize: job.geometry.pageSize });
  });

  it("saves the chosen orientation, paper and pages, and omits pageRanges for all pages", async () => {
    const { choice } = await openDialog();
    await pages(3);
    await pick(tp("printer"), tp("savePdf"));
    choose("landscape");
    await pick(tp("paper"), tp("paperSizes.letter"));
    choose("rangeCustom");
    fireEvent.change(within(dialogEl()).getByLabelText(tp("rangeCustomLabel")), { target: { value: "2-3" } });
    // The pages can be chosen only once the new sheet is laid out.
    await waitFor(() => expect(saveButton()).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(saveButton());
    expect(savePdfOptions(await choice)).toEqual({ landscape: true, pageSize: { width: 215_900, height: 279_400 }, pageRanges: [{ from: 1, to: 2 }] });
  });

  it("leaves pageRanges out when every page is saved", async () => {
    const { choice } = await openDialog();
    await pages(3);
    await pick(tp("printer"), tp("savePdf"));
    fireEvent.click(saveButton());
    expect("pageRanges" in savePdfOptions(await choice)).toBe(false);
  });

  it("refuses a bad page range for a PDF too, but never blocks it on copies", async () => {
    const { choice } = await openDialog();
    await pages(3);
    fireEvent.change(within(dialogEl()).getByLabelText(tp("copies")), { target: { value: "0" } });
    await pick(tp("printer"), tp("savePdf"));
    expect(within(dialogEl()).queryByText(tp("copiesInvalid"))).toBeNull();
    expect(saveButton()).not.toHaveAttribute("aria-disabled", "true");
    choose("rangeCustom");
    fireEvent.change(within(dialogEl()).getByLabelText(tp("rangeCustomLabel")), { target: { value: "5" } });
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(saveButton());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.change(within(dialogEl()).getByLabelText(tp("rangeCustomLabel")), { target: { value: "1" } });
    fireEvent.click(saveButton());
    expect(savePdfOptions(await choice).pageRanges).toEqual([{ from: 0, to: 0 }]);
  });

  it("disables copies, colour and duplex for Save as PDF but keeps pages, orientation and paper", async () => {
    await openDialog();
    await pages(3);
    expect(within(dialogEl()).getByLabelText(tp("copies"))).toBeEnabled();
    await pick(tp("printer"), tp("savePdf"));
    expect(within(dialogEl()).getByLabelText(tp("copies"))).toBeDisabled();
    expect(radio("colorDefault")).toHaveAttribute("aria-disabled", "true");
    expect(radio("colorColor")).toHaveAttribute("aria-disabled", "true");
    expect(radio("colorMono")).toHaveAttribute("aria-disabled", "true");
    expect(within(dialogEl()).getByRole("combobox", { name: tp("duplex") })).toBeDisabled();
    for (const key of ["rangeAll", "rangeCurrent", "rangeCustom", "portrait", "landscape"]) expect(radio(key)).not.toHaveAttribute("aria-disabled", "true");
    expect(within(dialogEl()).getByRole("combobox", { name: tp("paper") })).toBeEnabled();
  });

  it("sends a printer that needs the system dialog there: a note, a relabelled button, no setting applied", async () => {
    const { choice } = await openDialog(fakeBridge({ printers: [...PRINTERS, PDF_QUEUE] }).bridge);
    await pages(3);
    await pick(tp("printer"), PDF_QUEUE.name);
    expect(within(dialogEl()).getByText(tp("systemDialogNote"))).toBeInTheDocument();
    expect(within(dialogEl()).queryByRole("button", { name: tp("print") })).toBeNull();
    expect(within(dialogEl()).queryByRole("button", { name: tp("save") })).toBeNull();
    expect(within(dialogEl()).getByLabelText(tp("copies"))).toBeDisabled();
    for (const key of ["rangeAll", "rangeCurrent", "rangeCustom", "portrait", "landscape", "colorDefault", "colorColor", "colorMono"]) expect(radio(key)).toHaveAttribute("aria-disabled", "true");
    for (const name of [tp("paper"), tp("duplex")]) expect(within(dialogEl()).getByRole("combobox", { name })).toBeDisabled();
    fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("continueInSystemDialog") }));
    await expect(choice).resolves.toEqual({ kind: "system" });
  });

  it("shows the document's own sheet, not an unapplied choice, for a printer that needs the system dialog", async () => {
    const fake = fakeBridge({ printers: [...PRINTERS, PDF_QUEUE] });
    await openDialog(fake.bridge);
    await pages(3);
    choose("landscape");
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(2));
    await pick(tp("printer"), PDF_QUEUE.name);
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(3));
    expect(fake.of("desktop:print-preview")[2]!.payload.options).toEqual(job.geometry);
  });

  it("goes back to a plain printer and prints silently from the same dialog", async () => {
    const { choice } = await openDialog(fakeBridge({ printers: [...PRINTERS, PDF_QUEUE] }).bridge);
    await pages(3);
    await pick(tp("printer"), PDF_QUEUE.name);
    await pick(tp("printer"), tp("savePdf"));
    await pick(tp("printer"), "Office Laser");
    expect(within(dialogEl()).getByLabelText(tp("copies"))).toBeEnabled();
    fireEvent.click(printButton());
    await expect(choice).resolves.toMatchObject({ kind: "print", options: { silent: true, deviceName: "Office Laser" } });
  });
});

describe("re-laying out the preview", () => {
  const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  it("asks main again, after the debounce, when the orientation changes, and frees the old document", async () => {
    const fake = fakeBridge();
    await openDialog(fake.bridge);
    await pages(3);
    expect(fake.of("desktop:print-preview")).toHaveLength(1);

    choose("landscape");
    expect(fake.of("desktop:print-preview")).toHaveLength(1);
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(2));
    expect(fake.of("desktop:print-preview")[1]!.payload.options).toEqual({ landscape: true, pageSize: job.geometry.pageSize });
    await waitFor(() => expect(fake.engine("close").map((entry) => entry.payload.args!.pdfHandle)).toEqual(["handle-1"]));
    expect(fake.engine("open")).toHaveLength(2);
    expect(PREVIEW_DEBOUNCE_MS).toBeGreaterThanOrEqual(250);
  });

  it("asks once for a burst of changes", async () => {
    const fake = fakeBridge();
    await openDialog(fake.bridge);
    await pages(3);
    choose("landscape");
    choose("portrait");
    choose("landscape");
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(2));
    await wait(PREVIEW_DEBOUNCE_MS + 200);
    expect(fake.of("desktop:print-preview")).toHaveLength(2);
  });

  it("re-lays out for a new paper size", async () => {
    const fake = fakeBridge();
    await openDialog(fake.bridge);
    await pages(3);
    await pick(tp("paper"), tp("paperSizes.letter"));
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(2));
    expect(fake.of("desktop:print-preview")[1]!.payload.options).toEqual({ landscape: false, pageSize: { width: 215_900, height: 279_400 } });
  });

  it("never re-lays out for copies, page range, colour or duplex", async () => {
    const fake = fakeBridge();
    await openDialog(fake.bridge);
    await pages(3);
    fireEvent.change(within(dialogEl()).getByLabelText(tp("copies")), { target: { value: "4" } });
    choose("colorMono");
    choose("rangeCurrent");
    choose("rangeCustom");
    fireEvent.change(within(dialogEl()).getByLabelText(tp("rangeCustomLabel")), { target: { value: "1" } });
    await wait(PREVIEW_DEBOUNCE_MS + 300);
    expect(fake.of("desktop:print-preview")).toHaveLength(1);
    expect(fake.engine("open")).toHaveLength(1);
  });

  it("closes a document whose answer arrives after a newer request took over, then lays out the newer sheet", async () => {
    let release!: (value: unknown) => void;
    const fake = fakeBridge({ preview: (n) => (n === 1 ? new Promise((resolve) => { release = resolve; }) : { outcome: "ready", pdf: PDF }) });
    await openDialog(fake.bridge);
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(1));
    choose("landscape");
    await wait(PREVIEW_DEBOUNCE_MS + 100);
    // Main is still laying out the first copy: the second request waits, it is not sent into print_busy.
    expect(fake.of("desktop:print-preview")).toHaveLength(1);
    expect(screen.getByRole("region", { name: tp("preview") })).toHaveAttribute("aria-busy", "true");
    await act(async () => { release({ outcome: "ready", pdf: PDF }); });
    // The stale layout is opened by the engine, then freed without ever being shown.
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(2));
    expect(fake.of("desktop:print-preview")[1]!.payload.options).toEqual({ landscape: true, pageSize: job.geometry.pageSize });
    await waitFor(() => expect(fake.engine("close").map((entry) => entry.payload.args!.pdfHandle)).toEqual(["handle-1"]));
    await pages(3);
    await waitFor(() => expect(screen.getByRole("region", { name: tp("preview") })).toHaveAttribute("aria-busy", "false"));
    expect(within(dialogEl()).queryByText(tp("previewFailed"))).toBeNull();
    expect(radio("rangeCustom")).not.toHaveAttribute("aria-disabled", "true");
  });

  it("sends only the latest sheet when several changes arrive while a layout is running", async () => {
    let release!: (value: unknown) => void;
    const fake = fakeBridge({ preview: (n) => (n === 1 ? new Promise((resolve) => { release = resolve; }) : { outcome: "ready", pdf: PDF }) });
    await openDialog(fake.bridge);
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(1));
    choose("landscape");
    await wait(PREVIEW_DEBOUNCE_MS + 100);
    await pick(tp("paper"), tp("paperSizes.letter"));
    await wait(PREVIEW_DEBOUNCE_MS + 100);
    expect(fake.of("desktop:print-preview")).toHaveLength(1);
    await act(async () => { release({ outcome: "ready", pdf: PDF }); });
    await pages(3);
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(2));
    expect(fake.of("desktop:print-preview")[1]!.payload.options).toEqual({ landscape: true, pageSize: { width: 215_900, height: 279_400 } });
    await wait(PREVIEW_DEBOUNCE_MS + 100);
    expect(fake.of("desktop:print-preview")).toHaveLength(2);
    expect(fake.engine("close").map((entry) => entry.payload.args!.pdfHandle)).toEqual(["handle-1"]);
  });

  it("does not show a layout that finished while a newer change was still debouncing", async () => {
    let release!: (value: unknown) => void;
    const fake = fakeBridge({ preview: (n) => (n === 1 ? new Promise((resolve) => { release = resolve; }) : { outcome: "ready", pdf: PDF }) });
    await openDialog(fake.bridge);
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(1));
    choose("landscape");
    await act(async () => { release({ outcome: "ready", pdf: PDF }); });
    // The first copy is for the old sheet: it is freed, never shown as the answer to the new one.
    await waitFor(() => expect(fake.engine("close").map((entry) => entry.payload.args!.pdfHandle)).toEqual(["handle-1"]));
    expect(screen.queryAllByTestId("print-preview-page")).toHaveLength(0);
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(2));
    await pages(3);
  });

  it("asks once more when main still answers print_busy, and shows that preview", async () => {
    const fake = fakeBridge({ preview: (n) => (n === 1 ? { outcome: "failed", reason: "print_busy" } : { outcome: "ready", pdf: PDF }) });
    await openDialog(fake.bridge);
    await pages(3);
    expect(fake.of("desktop:print-preview")).toHaveLength(2);
    expect(within(dialogEl()).queryByText(tp("previewFailed"))).toBeNull();
  });

  it("gives up after one retry when main stays busy", async () => {
    const fake = fakeBridge({ preview: () => ({ outcome: "failed", reason: "print_busy" }) });
    await openDialog(fake.bridge);
    expect(await within(await screen.findByRole("dialog")).findByText(tp("previewFailed"), undefined, { timeout: 3000 })).toBeInTheDocument();
    await wait(PREVIEW_BUSY_RETRY_MS + 200);
    expect(fake.of("desktop:print-preview")).toHaveLength(2);
  });
});

describe("when the preview fails", () => {
  it("says a too-large document cannot be previewed, still prints all pages and keeps the system dialog", async () => {
    const fake = fakeBridge({ preview: () => ({ outcome: "failed", reason: "print_preview_too_large" }) });
    const { choice } = await openDialog(fake.bridge);
    expect(await within(await screen.findByRole("dialog")).findByText(tp("previewTooLarge"))).toBeInTheDocument();
    expect(fake.engine("open")).toHaveLength(0);
    expect(radio("rangeCurrent")).toHaveAttribute("aria-disabled", "true");
    expect(radio("rangeCustom")).toHaveAttribute("aria-disabled", "true");
    expect(within(dialogEl()).getByRole("button", { name: tp("systemDialog") })).toBeInTheDocument();
    expect(printButton()).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(printButton());
    const result = await choice;
    if (result.kind !== "print") throw new Error("expected print");
    expect("pageRanges" in result.options).toBe(false);
    expect(result.options).toMatchObject({ silent: true, deviceName: "Front Desk" });
  });

  it.each(["print_busy", "print_timeout", "print_unavailable"])("shows a message for %s and still offers printing", async (reason) => {
    await openDialog(fakeBridge({ preview: () => ({ outcome: "failed", reason }) }).bridge);
    expect(await within(await screen.findByRole("dialog")).findByText(tp("previewFailed"))).toBeInTheDocument();
    expect(within(dialogEl()).getByRole("button", { name: tp("systemDialog") })).toBeInTheDocument();
    expect(printButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("says too large, not unavailable, when the chosen sheet pushes the copy past the size cap", async () => {
    // Just under the cap in UTF-8 bytes: the sheet override that a changed orientation adds tips it over.
    const prefix = "<!DOCTYPE html><html><head></head><body><p>";
    const suffix = "</p></body></html>";
    const filler = "é".repeat(Math.floor((PRINT_HTML_MAX_BYTES - prefix.length - suffix.length - 8) / 2));
    const big = { ...job, html: prefix + filler + suffix };
    const fake = fakeBridge();
    let hook!: Hook;
    render(<Harness bridge={fake.bridge} onHook={(next) => { hook = next; }} />);
    act(() => { void hook.preview(big); });
    await pages(3);
    expect(new TextEncoder().encode(fake.of("desktop:print-preview")[0]!.payload.html as string).byteLength).toBeLessThanOrEqual(PRINT_HTML_MAX_BYTES);
    choose("landscape");
    expect(await within(dialogEl()).findByText(tp("previewTooLarge"))).toBeInTheDocument();
    expect(fake.of("desktop:print-preview")).toHaveLength(1);
    expect(radio("rangeCustom")).toHaveAttribute("aria-disabled", "true");
  });

  it("treats a rejected call, a malformed reply and an engine that cannot open the PDF as an unavailable preview", async () => {
    const rejecting = fakeBridge({ preview: () => { throw new Error("ipc"); } });
    const view = (await openDialog(rejecting.bridge)).view;
    expect(await within(await screen.findByRole("dialog")).findByText(tp("previewFailed"))).toBeInTheDocument();
    view.unmount();

    const malformed = fakeBridge({ preview: () => ({ outcome: "ready" }) });
    const second = (await openDialog(malformed.bridge)).view;
    expect(await within(await screen.findByRole("dialog")).findByText(tp("previewFailed"))).toBeInTheDocument();
    second.unmount();

    const noEngine = fakeBridge({ pageCount: 0 });
    await openDialog(noEngine.bridge);
    expect(await within(await screen.findByRole("dialog")).findByText(tp("previewFailed"))).toBeInTheDocument();
  });

  it("marks a page that cannot be drawn without losing the others", async () => {
    const fake = fakeBridge();
    const original = fake.call.getMockImplementation()!;
    fake.call.mockImplementation(async (channel, payload) => (payload.operation === "render" && payload.args!.pageIndex === 1 ? { ok: false } : await original(channel, payload)));
    await openDialog(fake.bridge);
    await pages(3);
    expect(await within(dialogEl()).findByText(tp("pageFailed"))).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
  });
});

describe("closing", () => {
  it("frees the engine's copy of the document when the dialog closes", async () => {
    const fake = fakeBridge();
    const { choice } = await openDialog(fake.bridge);
    await pages(3);
    expect(fake.engine("close")).toHaveLength(0);
    fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("cancel") }));
    await choice;
    await waitFor(() => expect(fake.engine("close")).toHaveLength(1));
    const open = fake.engine("open")[0]!;
    expect(fake.engine("close")[0]!.payload).toMatchObject({ sessionGeneration: "desktop-dev-session", handle: "print-preview", args: { pdfHandle: "handle-1", surface: open.payload.args!.surface } });
  });

  it("frees it after Print and after the system dialog too, and when the host unmounts", async () => {
    for (const how of ["print", "system", "unmount"] as const) {
      const fake = fakeBridge();
      const { choice, view } = await openDialog(fake.bridge);
      await pages(3);
      if (how === "print") fireEvent.click(printButton());
      if (how === "system") fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("systemDialog") }));
      if (how === "unmount") view.unmount();
      await choice;
      await waitFor(() => expect(fake.engine("close")).toHaveLength(1));
      view.unmount();
    }
  });

  it("frees a document that was still being laid out when the dialog closed", async () => {
    let release!: (value: unknown) => void;
    const fake = fakeBridge({ preview: () => new Promise((resolve) => { release = resolve; }) });
    const { choice } = await openDialog(fake.bridge);
    await waitFor(() => expect(fake.of("desktop:print-preview")).toHaveLength(1));
    fireEvent.click(within(dialogEl()).getByRole("button", { name: tp("cancel") }));
    await choice;
    await act(async () => { release({ outcome: "ready", pdf: PDF }); });
    await waitFor(() => expect(fake.engine("close")).toHaveLength(1));
  });
});
