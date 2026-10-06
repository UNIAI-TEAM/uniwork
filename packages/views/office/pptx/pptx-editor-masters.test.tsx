import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor } from "./pptx-editor";

/**
 * UNI-939 T01 (B6): View > Slide master mounts the master view in place of the
 * tab panel, its edits ride the editor's one edit channel, and Close master
 * returns to the deck.
 */
initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const MASTER = "ppt/slideMasters/slideMaster1.xml";
const deck = { deck: { slides: [{ id: "s1" }], size: { cx: 12192000, cy: 6858000 } }, revision: 1 };

const host = (): OfficeHost => ({ read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: vi.fn() as unknown as OfficeHost["ipc"]["call"], send: vi.fn(), subscribe: vi.fn() } });

const module = (): PptxRendererModule => ({
  makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
  buildRenderSlide: () => slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Title" })], top: 0, height: 24 }] }) })]),
});

/** A desktop-style handle: the master reads live on the handle, not in props. */
function handle() {
  const edit = vi.fn(async () => ({ revision: 2 }));
  const value = {
    format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), edit,
    masterParts: () => [{ partPath: MASTER, kind: "master" as const, name: "Office Theme" }],
    masterElements: () => [{ id: "e_2", type: "shape", label: "title", placeholder: "title", box: { x: 1, y: 2, w: 3, h: 4 }, fill: null }],
  };
  return { handle: value as unknown as EditorHandle, edit };
}

const toggle = () => document.querySelector('[data-ribbon-item="slideMaster"]') as HTMLElement;
const mastersPanel = () => document.querySelector("[data-pptx-masters-panel]");

describe("PptxEditor slide master view (T01)", () => {
  it("opens from View > Slide master, edits through the handle and closes back to the deck", async () => {
    const { handle: editorHandle, edit } = handle();
    render(<PptxEditor host={host()} editorHandle={editorHandle} loadRendererModule={async () => module()} slides={[{ id: "s1" }]} deck={deck} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    expect(mastersPanel()).toBeNull();
    fireEvent.click(toggle());
    expect(mastersPanel()).not.toBeNull();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    // MAJOR-2: the canvas shows the active part (the master opens first), not deck slide 1.
    const canvas = () => document.querySelector("[data-slide-canvas]") as HTMLElement;
    await waitFor(() => expect(canvas().querySelector("[data-pptx-master-preview]")).not.toBeNull());
    expect(canvas().querySelector('[data-master-element-id="e_2"]')).not.toBeNull();
    expect(canvas().querySelector("[data-pptx-master-preview-label]")).toHaveTextContent("Master: Office Theme (simplified preview)");

    // The handle's readers feed the view; a rename leaves through the handle's edit port.
    fireEvent.click(screen.getByText("Office Theme"));
    fireEvent.change(screen.getByLabelText("Master name"), { target: { value: "Brand" } });
    fireEvent.click(document.querySelector("[data-pptx-masters-rename]") as HTMLElement);
    await waitFor(() => expect(edit).toHaveBeenCalledWith([{ op: "master_rename", part: MASTER, name: "Brand" }]));

    fireEvent.click(screen.getByRole("button", { name: "Close master view" }));
    expect(mastersPanel()).toBeNull();
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("[data-pptx-master-preview]")).toBeNull();
    expect(document.querySelector("[data-pptx-master-preview-label]")).toBeNull();
    // Close master brings the deck slide back on the same canvas.
    expect(screen.getByText("Title")).toBeInTheDocument();
  });

  it("locks the Insert tab (new slide, shapes, header/footer, link, media) while the master view is open (master_fix3 #1)", async () => {
    const { handle: editorHandle } = handle();
    render(<PptxEditor host={host()} editorHandle={editorHandle} loadRendererModule={async () => module()} slides={[{ id: "s1" }]} deck={deck} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
    const insertItems = ["panel-sorter", "panel-insert", "panel-headerfooter", "panel-links", "panel-media"];
    const item = (id: string) => document.querySelector(`[data-ribbon-item="${id}"]`) as HTMLElement;

    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    for (const id of insertItems) expect(item(id), id).not.toHaveAttribute("aria-disabled");

    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(toggle());
    await waitFor(() => expect(document.querySelector("[data-pptx-master-preview]")).not.toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    for (const id of insertItems) expect(item(id), id).toHaveAttribute("aria-disabled", "true");
    // Pressing a locked item does nothing: no panel opens for the hidden slide, the master pane stays.
    const pressedBefore = item("panel-links").getAttribute("aria-pressed");
    fireEvent.click(item("panel-links"));
    expect(item("panel-links").getAttribute("aria-pressed")).toBe(pressedBefore);
    expect(mastersPanel()).not.toBeNull();

    // Close master gives the Insert tab back.
    fireEvent.click(screen.getByRole("button", { name: "Close master view" }));
    for (const id of insertItems) expect(item(id), id).not.toHaveAttribute("aria-disabled");
  });

  it("closes Find/Replace when the view opens, swallows Ctrl+F until Close master, and closes the sorter (find_gate F1/F2)", async () => {
    const { handle: editorHandle } = handle();
    render(<PptxEditor host={host()} editorHandle={editorHandle} loadRendererModule={async () => module()} slides={[{ id: "s1" }]} deck={deck} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
    const findPanel = () => screen.queryByRole("region", { name: "Find and replace" });
    const ctrlF = () => {
      const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
      fireEvent(document.body, event);
      return event;
    };

    // Find is open (and the View tab's default sorter panel is up) when the master view opens.
    ctrlF();
    expect(findPanel()).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    expect(document.querySelector("[data-pptx-sorter-panel]")).not.toBeNull();
    fireEvent.click(toggle());
    await waitFor(() => expect(document.querySelector("[data-pptx-master-preview]")).not.toBeNull());
    expect(findPanel()).toBeNull();
    expect(document.querySelector("[data-pptx-sorter-panel]")).toBeNull();
    expect(document.querySelector('[data-ribbon-item="panel-sorter"]')).toHaveAttribute("aria-disabled", "true");

    // Ctrl+F opens nothing, but the browser's own page find stays shut too.
    expect(ctrlF().defaultPrevented).toBe(true);
    expect(findPanel()).toBeNull();

    // Close master: Ctrl+F works again, the sorter does not come back by itself.
    fireEvent.click(screen.getByRole("button", { name: "Close master view" }));
    expect(document.querySelector("[data-pptx-sorter-panel]")).toBeNull();
    ctrlF();
    expect(findPanel()).not.toBeNull();
  });

  it("shows an applied text style in the preview: size and italic, re-read after the edit (master_fix3 #2)", async () => {
    let style: { sizePt?: number; italic?: boolean } | undefined;
    const edit = vi.fn(async (edits: readonly { op: string; sizePt?: number; italic?: boolean }[]) => {
      const [applied] = edits;
      if (applied?.op === "master_set_text_style") style = { ...(applied.sizePt !== undefined ? { sizePt: applied.sizePt } : {}), ...(applied.italic !== undefined ? { italic: applied.italic } : {}) };
      return { revision: 2 };
    });
    const editorHandle = {
      format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), edit,
      masterParts: () => [{ partPath: MASTER, kind: "master" as const, name: "Office Theme" }],
      masterElements: () => [{ id: "e_2", type: "shape", label: "title", placeholder: "title", box: { x: 48, y: 24, w: 384, h: 96 }, fill: null, ...(style ? { style } : {}) }],
    } as unknown as EditorHandle;
    render(<PptxEditor host={host()} editorHandle={editorHandle} loadRendererModule={async () => module()} slides={[{ id: "s1" }]} deck={deck} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(toggle());
    const previewText = () => document.querySelector('[data-master-element-id="e_2"] text') as SVGTextElement;
    await waitFor(() => expect(previewText()).not.toBeNull());
    expect(previewText().getAttribute("font-style")).toBeNull();

    fireEvent.click(screen.getAllByRole("option").find((option) => option.getAttribute("data-key") === "e_2") as HTMLElement);
    const form = document.querySelector("[data-pptx-masters-text-style]") as HTMLElement;
    fireEvent.change(within(form).getByLabelText("Size (pt)"), { target: { value: "40" } });
    fireEvent.click(within(form).getByRole("checkbox", { name: "Italic" }));
    fireEvent.click(document.querySelector("[data-pptx-masters-text-style-apply]") as HTMLButtonElement);
    await waitFor(() => expect(edit).toHaveBeenCalledWith([expect.objectContaining({ op: "master_set_text_style", sizePt: 40, italic: true })]));
    // The preview text is drawn from what the engine now holds: 40 pt at the page scale, italic.
    await waitFor(() => expect(previewText().getAttribute("font-style")).toBe("italic"));
    expect(Number(previewText().getAttribute("font-size"))).toBeGreaterThanOrEqual(40);
  });

  it("disables deck-slide edits while the master view hides the slide (F1)", async () => {
    const { handle: editorHandle, edit } = handle();
    const onTextEdit = vi.fn(async () => undefined);
    render(<PptxEditor host={host()} editorHandle={editorHandle} loadRendererModule={async () => module()} slides={[{ id: "s1" }]} deck={deck} onTextEdit={onTextEdit} onCommitText={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
    const item = (id: string) => document.querySelector(`[data-ribbon-item="${id}"]`) as HTMLElement;
    const rowOf = (menu: HTMLElement, action: string) => menu.querySelector(`[data-pptx-context-item="${action}"]`) as HTMLElement;
    const application = () => screen.getByRole("application", { name: "PowerPoint slide canvas" });

    // Baseline: a slide selection makes the slide commands live.
    fireEvent.keyDown(application(), { key: "a", ctrlKey: true });
    await waitFor(() => expect(item("font-bold")).not.toHaveAttribute("aria-disabled"));
    expect(item("edit-text")).not.toHaveAttribute("aria-disabled");

    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(toggle());
    await waitFor(() => expect(document.querySelector("[data-pptx-master-preview]")).not.toBeNull());

    // The hidden slide's selection is dropped and its ribbon commands wait for Close master.
    fireEvent.click(screen.getByRole("tab", { name: "Home" }));
    await waitFor(() => expect(item("font-bold")).toHaveAttribute("aria-disabled", "true"));
    expect(item("edit-text")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item("edit-text"));
    expect(onTextEdit).not.toHaveBeenCalled();

    // The canvas context menu offers no slide edit over the preview.
    fireEvent.contextMenu(application());
    const menu = await screen.findByRole("menu");
    for (const action of ["delete", "bring-to-front", "send-to-back", "edit-text", "insert"]) {
      expect(rowOf(menu, action)).toHaveAttribute("aria-disabled", "true");
      expect(rowOf(menu, action)).toHaveAttribute("data-capability", "unavailable");
    }
    expect(menu).toHaveTextContent("Close the master view to edit slides");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(edit).not.toHaveBeenCalled();

    // Close master (and the View tab toggle) stay usable; the slide commands return.
    fireEvent.click(screen.getByRole("button", { name: "Close master view" }));
    expect(item("edit-text")).not.toHaveAttribute("aria-disabled");
  });
});
