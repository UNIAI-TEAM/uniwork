import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { clearPptxThumbnailCache } from "./canvas/use-pptx-thumbnails";
import { box, chartNode, run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor, type PptxEditorProps } from "./pptx-editor";

/**
 * UNI-927 W5 (F-01/F-02/F-10): every built panel has a mount path from the
 * ribbon, bound to the editor's one edit channel and to the live selection.
 */
initI18n();
beforeEach(async () => {
  await setLocale("en");
  clearPptxThumbnailCache();
});

const deck = { deck: { slides: [{ id: "s1" }], size: { cx: 12192000, cy: 6858000 } }, revision: 1 };

function makeHost(): OfficeHost {
  return { read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: vi.fn() as unknown as OfficeHost["ipc"]["call"], send: vi.fn(), subscribe: vi.fn() } };
}

function makeHandle(edit = vi.fn(async () => ({ revision: 2 }))) {
  const handle = { format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), edit };
  return { handle: handle as unknown as EditorHandle, edit };
}

/** A text shape at (40,30)-(240,150) and a chart at (300,200)-(700,460), page 960x540. */
function deckModule(): PptxRendererModule {
  return {
    makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
    buildRenderSlide: () =>
      slide([
        shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Title" })], top: 0, height: 24 }] }) }),
        chartNode({ box: box({ x: 300, y: 200, w: 400, h: 260 }) }),
      ]),
  };
}

async function renderEditor(props: Partial<PptxEditorProps> = {}) {
  const { handle, edit } = makeHandle();
  const onApplyEdit = vi.fn(async () => undefined);
  render(
    <PptxEditor
      host={makeHost()}
      editorHandle={handle}
      loadRendererModule={async () => deckModule()}
      slides={[{ id: "s1" }]}
      deck={deck}
      onApplyEdit={onApplyEdit}
      {...props}
    />,
  );
  await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
  return { onApplyEdit, edit };
}

function clickSlideAt(x: number, y: number) {
  const overlay = screen.getByRole("application").querySelector("[data-pptx-selection-overlay]") as HTMLElement;
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  fireEvent.pointerDown(overlay, { button: 0, clientX: x, clientY: y });
  fireEvent.pointerUp(overlay, { button: 0, clientX: x, clientY: y });
}

const item = (id: string) => document.querySelector(`[data-ribbon-item="${id}"]`) as HTMLElement | null;
const panelHost = () => document.querySelector("[data-pptx-panel-host]");

describe("PptxEditor panel mounting (UNI-927 W5)", () => {
  it("puts the Font and Paragraph controls on Home and binds Bold to the selected element (F-01)", async () => {
    const { onApplyEdit } = await renderEditor();
    expect(item("font-family")).not.toBeNull();
    expect(item("align-center")).not.toBeNull();
    // Nothing selected: the control is disabled with its reason and never edits.
    expect(item("font-bold")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item("font-bold") as HTMLElement);
    expect(onApplyEdit).not.toHaveBeenCalled();
    clickSlideAt(100, 80);
    await waitFor(() => expect(item("font-bold")).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(item("font-bold") as HTMLElement);
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledWith(expect.objectContaining({ op: "set_font", slideIndex: 0, elementId: "shape-1" })));
  });

  it("opens the text-format panel from the Font dialog launcher (F-01)", async () => {
    await renderEditor();
    expect(panelHost()).toBeNull();
    fireEvent.click(document.querySelector('[data-ribbon-launcher="font"]') as HTMLElement);
    expect(panelHost()?.querySelector("[data-pptx-text-format-panel]")).not.toBeNull();
  });

  it("reaches tables, charts, links, header/footer and media from the Insert tab (F-01/F-02)", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(panelHost()?.querySelector("[data-pptx-insert-panel]")).not.toBeNull();
    const reach = (id: string, selector: string) => {
      fireEvent.click(item(id) as HTMLElement);
      expect(panelHost()?.querySelector(selector)).not.toBeNull();
    };
    reach("tables", "[data-pptx-tables-panel]");
    reach("charts", "[data-pptx-charts-panel]");
    reach("panel-links", "[data-pptx-link-editor]");
    reach("panel-headerfooter", "[data-pptx-headerfooter-panel]");
    reach("panel-media", "[data-pptx-media-panel]");
    // Picking the open panel again closes it.
    fireEvent.click(item("panel-media") as HTMLElement);
    expect(panelHost()).toBeNull();
  });

  it("hosts comments and speaker notes on the Review tab (F-01)", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(item("panel-comments") as HTMLElement);
    expect(panelHost()?.querySelector("[data-pptx-comments-panel]")).not.toBeNull();
    fireEvent.click(item("speaker-notes") as HTMLElement);
    expect(document.querySelector('[data-pptx-panel-placement="bottom"] [data-pptx-notes-pane]')).not.toBeNull();
  });

  it("opens a Chart Design tab for a chart selection and mounts the charts panel on it (F-10)", async () => {
    await renderEditor();
    expect(screen.queryByRole("tab", { name: "Chart Design" })).not.toBeInTheDocument();
    clickSlideAt(500, 330);
    const tab = await screen.findByRole("tab", { name: "Chart Design" });
    fireEvent.click(tab);
    expect(panelHost()?.querySelector("[data-pptx-charts-panel]")).not.toBeNull();
    expect(item("arrange-front")).not.toBeNull();
  });

  it("gives the Shape Format tab the format pane and a working Arrange group (F-10)", async () => {
    const { edit } = await renderEditor();
    clickSlideAt(100, 80);
    fireEvent.click(await screen.findByRole("tab", { name: "Shape Format" }));
    expect(panelHost()?.querySelector("[data-pptx-format-panel]")).not.toBeNull();
    fireEvent.click(item("panel-text-format") as HTMLElement);
    expect(panelHost()?.querySelector("[data-pptx-text-format-panel]")).not.toBeNull();
    fireEvent.click(item("arrange-front") as HTMLElement);
    await waitFor(() => expect(edit).toHaveBeenCalledWith([{ op: "reorder_element", slideIndex: 0, elementId: "shape-1", dir: "front" }]));
  });

  it("disables the editing panels with a reason when no edit channel is bound (F-02)", async () => {
    render(<PptxEditor host={makeHost()} editorHandle={null} slides={[{ id: "s1" }]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(item("panel-media")).toHaveAttribute("aria-disabled", "true");
    expect(item("tables")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item("panel-media") as HTMLElement);
    expect(panelHost()?.querySelector("[data-pptx-media-panel]") ?? null).toBeNull();
  });
  it("reads the deck's speaker notes into the notes pane and survives a throwing reader (W4 F-06)", async () => {
    await renderEditor({ slideNotes: () => "Ghi chú trình bày cho buổi họp tuần." });
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(screen.getByDisplayValue("Ghi chú trình bày cho buổi họp tuần.")).toBeInTheDocument();
  });

  it("keeps the editor up when the notes reader throws (adapter no_slide / notes_unbound)", async () => {
    await renderEditor({ slideNotes: () => { throw new Error("notes_unbound"); } });
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(document.querySelector("[data-pptx-notes-pane]")).not.toBeNull();
  });

  it("feeds the handle's live transition and animation reads into their panels and re-reads after a history move (X1)", async () => {
    let state: { transition: { kind: string; advanceMs: number | null }; animations: object[] } = { transition: { kind: "fade", advanceMs: 3000 }, animations: [{ spid: 2, elementId: "shape-1", effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 }] };
    const base = makeHandle().handle;
    const handle = Object.assign(base, { slideTransition: vi.fn(() => state.transition), slideAnimations: vi.fn(() => state.animations) });
    const props = { host: makeHost(), editorHandle: handle, loadRendererModule: async () => deckModule(), slides: [{ id: "s1" }], onApplyEdit: vi.fn(async () => undefined) };
    const view = render(<PptxEditor {...props} deck={deck} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Transitions" }));
    expect(screen.getByTestId("pptx-transitions-current")).toHaveTextContent("Current transition: Fade");
    expect(handle.slideTransition).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("tab", { name: "Animations" }));
    expect(screen.getByRole("button", { name: "Fade, starts On click" })).toBeInTheDocument();
    // An undo moves the live deck: the next render reads the new state.
    state = { transition: { kind: "none", advanceMs: null }, animations: [] };
    view.rerender(<PptxEditor {...props} deck={{ ...deck, revision: 2 }} />);
    expect(screen.getByTestId("pptx-animation-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Transitions" }));
    expect(screen.getByTestId("pptx-transitions-current")).toHaveTextContent("Current transition: None");
  });

  it("shows the rail's generated thumbnails on the sorter tiles (R2-12)", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    await waitFor(() => {
      const image = document.querySelector('[data-pptx-sorter-panel] [data-slide-index="0"] img');
      expect(image?.getAttribute("src")).toContain("data:image/svg+xml");
    });
  });

  it("selects a slide in the editor from a sorter tile (W4 F-13)", async () => {
    const onSlideSelect = vi.fn();
    render(<PptxEditor host={makeHost()} editorHandle={makeHandle().handle} slides={[{ id: "s1" }, { id: "s2" }]} onSlideSelect={onSlideSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(document.querySelector('[data-pptx-sorter-panel] [data-slide-index="1"] button') as HTMLElement);
    expect(onSlideSelect).toHaveBeenCalledWith(1);
  });

  it("runs Ctrl+Z from a ribbon control, but leaves native undo to text inputs (W2 F-15)", async () => {
    const { handle } = makeHandle();
    render(<PptxEditor host={makeHost()} editorHandle={handle} slides={[{ id: "s1" }]} deck={deck} loadRendererModule={async () => deckModule()} slideNotes={() => "Note"} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("tab", { name: "Home" }), { key: "z", ctrlKey: true });
    expect(handle.undo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    const notes = document.querySelector("[data-pptx-notes-pane] textarea") as HTMLElement;
    fireEvent.keyDown(notes, { key: "z", ctrlKey: true });
    expect(handle.undo).toHaveBeenCalledTimes(1);
  });

  it("opens the Insert tab from the canvas context menu (W2 F-14)", async () => {
    await renderEditor();
    fireEvent.contextMenu(screen.getByRole("application"));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Insert/ }));
    await waitFor(() => expect(panelHost()?.querySelector("[data-pptx-insert-panel]")).not.toBeNull());
  });
});
