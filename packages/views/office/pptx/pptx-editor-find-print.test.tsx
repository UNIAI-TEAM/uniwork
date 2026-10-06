// UNI-927 X4 (R2-6) - the find panel and the print commands inside the real editor.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor, type PptxEditorProps } from "./pptx-editor";
import type { PptxPrintPort } from "./print";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const host = { read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: vi.fn(), send: vi.fn(), subscribe: vi.fn() } } as unknown as OfficeHost;
const textOf = (value: string) => ({ paragraphs: [{ runs: [{ text: value }] }] });
const deck = {
  deck: {
    slides: [
      { id: "s1", elements: [{ id: "shape-1", type: "shape", text: textOf("Alpha budget") }] },
      { id: "s2", elements: [{ id: "shape-1", type: "shape", text: textOf("Second budget and budget") }] },
    ],
    size: { cx: 12192000, cy: 6858000 },
  },
  revision: 1,
};
const slides = [{ id: "s1" }, { id: "s2" }];

const rendererModule: PptxRendererModule = {
  makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
  buildRenderSlide: (_slide, _size, options: { fitWidthPx: number }) =>
    slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Rendered title" })], top: 0, height: 24 }] }) })], {
      widthPx: options.fitWidthPx,
      heightPx: options.fitWidthPx * (6858000 / 12192000),
    }),
};

function handle(extra: Record<string, unknown> = {}) {
  return { format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), ...extra } as unknown as EditorHandle;
}

function renderEditor(props: Partial<PptxEditorProps> = {}) {
  return render(<PptxEditor host={host} editorHandle={handle()} loadRendererModule={async () => rendererModule} slides={slides} deck={deck} {...props} />);
}

const query = () => screen.getByRole("textbox", { name: "Find" });
const count = () => document.querySelector("[data-pptx-find-count]") as HTMLElement;
const canvas = () => screen.getByRole("application", { name: "PowerPoint slide canvas" });

describe("PptxEditor find & replace (R2-6)", () => {
  it("opens on Ctrl+F with nothing focused, and focuses the query field", () => {
    renderEditor();
    expect(screen.queryByRole("region", { name: "Find and replace" })).not.toBeInTheDocument();
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("region", { name: "Find and replace" })).toBeInTheDocument();
    expect(document.activeElement).toBe(query());
  });

  it("opens on Ctrl+F from the ribbon too, and refocuses the open field instead of closing it", () => {
    renderEditor();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Home" }), { key: "f", ctrlKey: true });
    expect(query()).toBeInTheDocument();
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.keyDown(undo, { key: "f", ctrlKey: true });
    expect(screen.getAllByRole("textbox", { name: "Find" })).toHaveLength(1);
    expect(document.activeElement).toBe(query());
  });

  it("leaves Ctrl+F to the browser while the slide show owns the keyboard", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("region", { name: "Find and replace" })).not.toBeInTheDocument();
  });

  it("counts hits over the bound deck, steps through them and moves the canvas to the hit's slide", async () => {
    const onSlideSelect = vi.fn();
    renderEditor({ onSlideSelect });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    fireEvent.keyDown(canvas(), { key: "f", ctrlKey: true });
    fireEvent.change(query(), { target: { value: "budget" } });
    // One hit per occurrence: "Alpha budget" has one, "Second budget and budget" has two.
    expect(count()).toHaveTextContent("Match 1 of 3");
    await waitFor(() => expect(document.querySelector("[data-pptx-selection-outline]")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Find next" }));
    expect(count()).toHaveTextContent("Match 2 of 3");
    await waitFor(() => expect(onSlideSelect).toHaveBeenCalledWith(1));
    fireEvent.change(query(), { target: { value: "nothing like it" } });
    expect(count()).toHaveTextContent("No matches");
  });

  it("replaces through the handle's edit channel: the active hit's element, then everything", async () => {
    const edit = vi.fn(async () => ({ revision: 2 }));
    renderEditor({ editorHandle: handle({ edit }) });
    fireEvent.keyDown(canvas(), { key: "f", ctrlKey: true });
    fireEvent.change(query(), { target: { value: "budget" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith([{ op: "find_replace", find: "budget", replace: "plan", matchCase: false, firstOnly: true, slideIndex: 0, elementId: "shape-1", occurrence: 0 }]));
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(edit).toHaveBeenLastCalledWith([{ op: "find_replace", find: "budget", replace: "plan", matchCase: false }]));
  });

  it("advances to the next remaining hit after Replace instead of jumping back to the first (X4fix F5)", async () => {
    const edit = vi.fn(async () => ({ revision: 2 }));
    const view = renderEditor({ editorHandle: handle({ edit }) });
    fireEvent.keyDown(canvas(), { key: "f", ctrlKey: true });
    fireEvent.change(query(), { target: { value: "budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Find next" }));
    expect(count()).toHaveTextContent("Match 2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith([expect.objectContaining({ slideIndex: 1, elementId: "shape-1", occurrence: 0 })]));
    // The host re-publishes the deck: slide 2's run lost its first match but keeps a second one.
    const edited = { ...deck, deck: { ...deck.deck, slides: [deck.deck.slides[0]!, { id: "s2", elements: [{ id: "shape-1", type: "shape", text: textOf("Second plan and budget") }] }] }, revision: 2 };
    view.rerender(<PptxEditor host={host} editorHandle={handle({ edit })} loadRendererModule={async () => rendererModule} slides={slides} deck={edited} />);
    await waitFor(() => expect(count()).toHaveTextContent("Match 2 of 2"));
  });

  it("closes on Escape from the replace field too, and returns focus to the Find trigger (X4fix F6)", () => {
    renderEditor();
    const trigger = screen.getByRole("button", { name: "Find" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Replace with" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Find and replace" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("is search-only without an edit channel: replace stays off and says the deck is read-only", () => {
    renderEditor();
    fireEvent.keyDown(canvas(), { key: "f", ctrlKey: true });
    fireEvent.change(query(), { target: { value: "budget" } });
    expect(count()).toHaveTextContent("Match 1 of 3");
    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace all" })).toBeDisabled();
    expect(screen.getByTestId("pptx-find-unbound")).toHaveTextContent("read-only");
  });
});

describe("PptxEditor print commands (R2-6)", () => {
  const printPort = (): PptxPrintPort => ({ available: true, mode: "browser", print: vi.fn(async () => ({ outcome: "printed" as const, mode: "browser" as const })) });

  it("shows Print and Export PDF once the host binds the browser path and the deck renderer is up; hides Open (no channel)", async () => {
    renderEditor({ printPort: "browser" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Print" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });

  it("hides both commands when the host binds no print path (X4fix F2: the desktop today)", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export PDF" })).not.toBeInTheDocument();
  });

  it("surfaces a print run the port reports as failed instead of dropping it (X4fix F1)", async () => {
    const port: PptxPrintPort = { available: true, mode: "browser", print: vi.fn(async () => ({ outcome: "failed" as const, reason: "No print frame is available." })) };
    const onCommandError = vi.fn();
    renderEditor({ printPort: port, onCommandError });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No print frame is available."));
    expect(onCommandError).toHaveBeenCalledWith(expect.objectContaining({ message: "No print frame is available." }));
  });

  it("hides both commands when the host turns printing off or there is no deck to print", () => {
    const { unmount } = renderEditor({ printPort: null });
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export PDF" })).not.toBeInTheDocument();
    unmount();
    renderEditor({ deck: undefined });
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
  });

  it.each(["Print", "Export PDF"])("%s sends the rendered deck through the print port", async (name) => {
    const port = printPort();
    renderEditor({ printPort: port });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(port.print).toHaveBeenCalledTimes(1));
    const request = vi.mocked(port.print).mock.calls[0]![0];
    expect(request.slides).toHaveLength(2);
    expect(request.slides[0]!.markup).toContain("<svg");
  });
});
