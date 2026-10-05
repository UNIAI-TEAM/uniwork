import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { clearPptxThumbnailCache } from "./canvas/use-pptx-thumbnails";
import { box, run, shapeNode, slide, tableNode, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor, type PptxEditorProps } from "./pptx-editor";

initI18n();
beforeEach(async () => {
  await setLocale("en");
  clearPptxThumbnailCache();
});

function makeHost(call: ReturnType<typeof vi.fn>): OfficeHost {
  return { read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: call as unknown as OfficeHost["ipc"]["call"], send: vi.fn(), subscribe: vi.fn() } };
}

function handle() {
  return { format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn() } as unknown as EditorHandle;
}

const deck = { deck: { slides: [{ id: "s1" }, { id: "s2" }], size: { cx: 12192000, cy: 6858000 } }, revision: 1 };

/** Artifact stand-in: the real bundle is never loaded by a unit test. */
function fakeRendererModule(text = "Rendered title"): { module: PptxRendererModule; buildRenderSlide: ReturnType<typeof vi.fn> } {
  const buildRenderSlide = vi.fn((_slide: unknown, _size: unknown, options: { fitWidthPx: number }) =>
    slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text })], top: 0, height: 24 }] }) })], {
      widthPx: options.fitWidthPx,
      heightPx: options.fitWidthPx * (6858000 / 12192000),
    }),
  );
  const module: PptxRendererModule = {
    makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
    buildRenderSlide,
  };
  return { module, buildRenderSlide };
}

/** Artifact stand-in that renders a table node, for the R4 contextual-tab pin. */
function tableRendererModule(): { module: PptxRendererModule } {
  const module: PptxRendererModule = {
    makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
    buildRenderSlide: (_slide: unknown, _size: unknown, options: { fitWidthPx: number }) =>
      slide([tableNode({ box: box({ x: 100, y: 80, w: 240, h: 100 }) })], {
        widthPx: options.fitWidthPx,
        heightPx: options.fitWidthPx * (6858000 / 12192000),
      }),
  };
  return { module };
}

/** The presenter console lives on the Slide Show tab (F-05: the tab-row Present
 *  control starts the audience show instead). */
function presenterViewItem(): HTMLElement {
  fireEvent.click(screen.getByRole("tab", { name: "Slide Show" }));
  return document.querySelector('[data-ribbon-item="show-presenter-view"]') as HTMLElement;
}

function renderEditor(props: Partial<PptxEditorProps> = {}, text = "Rendered title") {
  const { module, buildRenderSlide } = fakeRendererModule(text);
  const view = render(<PptxEditor host={makeHost(vi.fn())} editorHandle={handle()} loadRendererModule={async () => module} {...props} />);
  return { view, buildRenderSlide };
}

describe("PptxEditor", () => {
  it("routes shape gestures through the host channel and waits before undo", async () => {
    let resolve!: (value: unknown) => void;
    const call = vi.fn(() => new Promise((done) => { resolve = done; }));
    const editorHandle = handle();
    render(
      <PptxEditor
        host={makeHost(call)}
        editorHandle={editorHandle}
        loadRendererModule={async () => fakeRendererModule().module}
        slides={[{ id: "s1" }]}
        transformRequest={{ slideIndex: 0, sourceId: "shape-1", xPx: 24, yPx: 16, wPx: 320, hPx: 180, fitWidthPx: 960 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Shape / image" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("host:slides-edit-transform", expect.objectContaining({ slideIndex: 0, sourceId: "shape-1" })));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(editorHandle.undo).not.toHaveBeenCalled();
    resolve({ slide: 0 });
    await waitFor(() => expect(editorHandle.undo).toHaveBeenCalledTimes(1));
  });

  it("uses the save coordinator and never writes bytes from the toolbar", () => {
    const call = vi.fn();
    const save = vi.fn(async () => undefined);
    const host = makeHost(call);
    render(<PptxEditor host={host} editorHandle={handle()} loadRendererModule={async () => fakeRendererModule().module} slides={[{ id: "s1" }]} saveCoordinator={{ save, getState: () => ({}) as never }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith("button");
    expect(host.write.writeOutput).not.toHaveBeenCalled();
  });

  it("does not advertise edit commands without a bound host operation", () => {
    // The disabled flag and its reason tooltip are pinned on the mapped data in
    // pptx-ribbon.test.ts. With no host operation bound the three commands are
    // inert: clicking them must not run a handler or surface a command error.
    const onCommandError = vi.fn();
    renderEditor({ slides: [{ id: "s1" }], onCommandError });
    for (const id of ["open", "edit-text", "edit-shape-image"]) {
      const button = document.querySelector(`[data-ribbon-item="${id}"]`) as HTMLButtonElement;
      expect(button).not.toBeNull();
      fireEvent.click(button);
    }
    expect(onCommandError).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("surfaces a rejected transform as a typed command error", async () => {
    const onTransform = vi.fn(async () => { throw new Error("transform refused"); });
    renderEditor({
      slides: [{ id: "s1" }],
      transformRequest: { slideIndex: 0, sourceId: "shape-1", xPx: 24, yPx: 16, wPx: 320, hPx: 180, fitWidthPx: 960 },
      onTransform,
    });
    fireEvent.click(screen.getByRole("button", { name: "Shape / image" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("transform refused"));
    expect(onTransform).toHaveBeenCalledTimes(1);
  });

  it("keeps the canvas keyboard path wired to slide selection", () => {
    const onSlideSelect = vi.fn();
    renderEditor({ slides: [{ id: "s1" }, { id: "s2" }], onSlideSelect });
    fireEvent.keyDown(screen.getByRole("application", { name: "PowerPoint slide canvas" }), { key: "ArrowDown" });
    expect(onSlideSelect).toHaveBeenCalledWith(1);
  });

  it("renders the deck through the injected artifact and requests the fit width", async () => {
    const { buildRenderSlide } = renderEditor({ slides: [{ id: "s1" }, { id: "s2" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    expect(buildRenderSlide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cx: 12192000 }), expect.objectContaining({ fitWidthPx: 960, slideNo: 1 }));
    expect(screen.getByRole("application").querySelector("[data-slide-canvas]")).toHaveAttribute("data-slide-index", "0");
  });

  it("rebuilds the rendition for the selected slide only", async () => {
    const { buildRenderSlide } = renderEditor({ slides: [{ id: "s1" }, { id: "s2" }], deck });
    // P0-2 F3: the rail builds every slide at 160 px through the same artifact spy, so
    // isolate the on-screen rendition (960 px) instead of counting every call.
    const renditions = () => (buildRenderSlide.mock.calls as Array<[unknown, unknown, { fitWidthPx?: number; slideNo?: number }]>)
      .filter((call) => call[2]?.fitWidthPx === 960);
    await waitFor(() => expect(renditions()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Slide 2" }));
    await waitFor(() => expect(renditions().some((call) => call[2]?.slideNo === 2)).toBe(true));
    expect(renditions()).toHaveLength(2);
  });

  it("fills the rail with generated thumbnails", async () => {
    renderEditor({ slides: [{ id: "s1", label: "Intro" }, { id: "s2" }], deck });
    await waitFor(() => {
      const image = screen.getByRole("navigation", { name: "Slides" }).querySelector("img");
      expect(image?.getAttribute("src")).toContain("data:image/svg+xml");
    });
  });

  it("reports an artifact that cannot be loaded instead of rendering nothing", async () => {
    render(<PptxEditor host={makeHost(vi.fn())} editorHandle={handle()} loadRendererModule={async () => { throw new Error("bundle missing"); }} slides={[{ id: "s1" }]} deck={deck} />);
    await waitFor(() => expect(screen.getByTestId("pptx-render-error")).toHaveTextContent("bundle missing"));
    expect(screen.getByTestId("pptx-render-pending")).toBeInTheDocument();
  });

  it("opens the presenter over the SAME rendition the canvas mounts", async () => {
    renderEditor({ slides: [{ id: "s1", label: "Intro" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    const canvasSvg = document.querySelector("[data-pptx-slide-svg]") as SVGElement;
    fireEvent.click(screen.getByRole("tab", { name: "Slide Show" }));
    fireEvent.click(presenterViewItem());
    const dialog = screen.getByRole("dialog", { name: "Presenter view" });
    const presenterSvg = dialog.querySelector("[data-pptx-presenter-svg]") as SVGElement;
    expect(presenterSvg).not.toBeNull();
    // WIRE-CANVAS-BIND: the same render tree, not the 160px rail thumbnail.
    expect(presenterSvg.innerHTML).toBe(canvasSvg.innerHTML);
    fireEvent.click(screen.getByRole("button", { name: "Close presenter" }));
    expect(screen.queryByRole("dialog", { name: "Presenter view" })).not.toBeInTheDocument();
  });

  it("mounts the shared Office ribbon instead of the raw command-id row", () => {
    renderEditor({ slides: [{ id: "s1" }] });
    // The tablist label now belongs to the shared ribbon (amendment R), not the
    // lane's own strip.
    expect(screen.getByRole("tablist", { name: "Ribbon tabs" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(8);
    expect(document.querySelector('[data-ribbon-item="open"]')).not.toBeNull();
    // The honestly empty tab drops the Home groups entirely.
    fireEvent.click(screen.getByRole("tab", { name: "Transitions" }));
    expect(document.querySelector('[data-ribbon-item="open"]')).toBeNull();
  });

  it("binds Ctrl+Y and Ctrl+Shift+Z to redo on the canvas", () => {
    const editorHandle = handle();
    render(<PptxEditor host={makeHost(vi.fn())} editorHandle={editorHandle} loadRendererModule={async () => fakeRendererModule().module} slides={[{ id: "s1" }]} />);
    const canvas = screen.getByRole("application", { name: "PowerPoint slide canvas" });
    fireEvent.keyDown(canvas, { key: "y", ctrlKey: true });
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true, shiftKey: true });
    expect(editorHandle.redo).toHaveBeenCalledTimes(2);
  });

  it("mounts the selection overlay inside the rendered slide box", async () => {
    renderEditor({ slides: [{ id: "s1" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    const slideBox = screen.getByRole("application").querySelector("[data-slide-canvas]");
    expect(slideBox?.querySelector("[data-pptx-selection-overlay]")).not.toBeNull();
  });

  it("selects on a canvas click and routes Delete through the handle's edit channel", async () => {
    const edit = vi.fn(async () => ({ revision: 1 }));
    const editorHandle = { ...handle(), edit } as unknown as EditorHandle;
    renderEditor({ slides: [{ id: "s1" }], deck, editorHandle });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    const overlay = screen.getByRole("application").querySelector("[data-pptx-selection-overlay]") as HTMLElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.pointerDown(overlay, { button: 0, clientX: 150, clientY: 100 });
    // F3: the overlay no longer preventDefaults away the browser's focus move; it focuses
    // the canvas itself, so the keyboard bindings are live in the click-first flow.
    const canvas = screen.getByRole("application", { name: "PowerPoint slide canvas" });
    expect(document.activeElement).toBe(canvas);
    fireEvent.pointerUp(overlay, { button: 0, clientX: 150, clientY: 100 });
    await waitFor(() => expect(overlay.querySelector("[data-pptx-selection-outline]")).not.toBeNull());
    fireEvent.keyDown(canvas, { key: "Delete" });
    await waitFor(() => expect(edit).toHaveBeenCalledWith([{ op: "delete_element", slideIndex: 0, elementId: "shape-1" }]));
  });

  it("binds Ctrl+A to select every element on the canvas", async () => {
    renderEditor({ slides: [{ id: "s1" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    const canvas = screen.getByRole("application", { name: "PowerPoint slide canvas" });
    fireEvent.keyDown(canvas, { key: "a", ctrlKey: true });
    await waitFor(() => expect(canvas.querySelector("[data-pptx-selection-outline]")).not.toBeNull());
  });

  it("never upscales the rail thumbnail in the presenter", async () => {
    renderEditor({ slides: [{ id: "s1", label: "Intro" }], deck });
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Slides" }).querySelector("img")).not.toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Slide Show" }));
    fireEvent.click(presenterViewItem());
    const dialog = screen.getByRole("dialog", { name: "Presenter view" });
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector("[data-pptx-presenter-svg]")).not.toBeNull();
  });

  it("renders the bound speaker-notes port in the presenter (NOTES-WIRE)", async () => {
    renderEditor({ slides: [{ id: "s1" }], deck, slideNotes: (slideIndex) => (slideIndex === 0 ? "Open with the customer story" : null) });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    fireEvent.click(presenterViewItem());
    expect(screen.getByTestId("pptx-presenter-notes")).toHaveTextContent("Open with the customer story");
  });

  it("keeps the honest empty-notes line without a slideNotes port (NOTES-WIRE)", async () => {
    renderEditor({ slides: [{ id: "s1" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    fireEvent.click(presenterViewItem());
    expect(screen.getByTestId("pptx-presenter-notes")).toHaveTextContent("No speaker notes for this slide.");
  });

  it("reads the speaker-notes port off the editor handle (desktop binding, NOTES-WIRE)", async () => {
    const editorHandle = { ...handle(), slideNotes: (slideIndex: number) => (slideIndex === 0 ? "Desktop notes" : null) } as unknown as EditorHandle;
    render(<PptxEditor host={makeHost(vi.fn())} editorHandle={editorHandle} loadRendererModule={async () => fakeRendererModule().module} slides={[{ id: "s1" }]} deck={deck} />);
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    fireEvent.click(presenterViewItem());
    expect(screen.getByTestId("pptx-presenter-notes")).toHaveTextContent("Desktop notes");
  });

  it("labels a bound deck that is still building instead of claiming rendering is unbound", async () => {
    let resolveModule!: (module: PptxRendererModule) => void;
    const load = () => new Promise<PptxRendererModule>((resolve) => { resolveModule = resolve; });
    render(<PptxEditor host={makeHost(vi.fn())} editorHandle={handle()} loadRendererModule={load} slides={[{ id: "s1" }]} deck={deck} />);
    expect(screen.getByTestId("pptx-render-pending")).toHaveTextContent("Building the slide rendition");
    resolveModule(fakeRendererModule().module);
    await waitFor(() => expect(screen.queryByTestId("pptx-render-pending")).toBeNull());
  });

  it("disposes the one editor handle when the view unmounts", async () => {
    const editorHandle = handle();
    const view = render(<PptxEditor host={makeHost(vi.fn())} editorHandle={editorHandle} loadRendererModule={async () => fakeRendererModule().module} slides={[{ id: "s1" }]} />);
    view.unmount();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(editorHandle.dispose).toHaveBeenCalledTimes(1);
  });
  it("renders the C10 status bar with slide x/y, counts, language, selection and zoom", () => {
    renderEditor({ slides: [{ id: "s1" }, { id: "s2" }] });
    const bar = screen.getByRole("group", { name: "Presentation status" });
    expect(bar.closest("[data-pptx-status-bar]")).not.toBeNull();
    expect(screen.getByTestId("pptx-status-slide")).toHaveTextContent("Slide 1 / 2");
    expect(screen.getByTestId("pptx-status-selection")).toHaveTextContent("No selection");
    expect(bar.querySelector("[data-pptx-zoom]")).not.toBeNull();
  });

  it("never shows the UI locale as the deck language (F1)", () => {
    // `document.documentElement.lang` is the app UI locale, not the deck's
    // language. With no deck-language source wired the bar must show the
    // unknown mark instead of echoing the UI locale.
    const previous = document.documentElement.lang;
    document.documentElement.lang = "vi";
    renderEditor({ slides: [{ id: "s1" }] });
    const language = screen.getByTestId("pptx-status-language");
    expect(language).toHaveTextContent("Language: —");
    expect(language.textContent ?? "").not.toContain("vi");
    document.documentElement.lang = previous;
  });

  it("keeps the ribbon free of the selection/position readout that the status bar owns (C6)", () => {
    renderEditor({ slides: [{ id: "s1" }] });
    const toolbar = document.querySelector("[data-pptx-toolbar]") as HTMLElement;
    expect(toolbar.textContent ?? "").not.toMatch(/Selection \d/);
    expect(toolbar.textContent ?? "").not.toMatch(/Slide \d+ of \d+/);
  });

  it("has no floating command button over the slide, only the contextual selection overlay (C9)", async () => {
    renderEditor({ slides: [{ id: "s1" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    const slideBox = screen.getByRole("application").querySelector("[data-slide-canvas]") as HTMLElement;
    // The only absolutely positioned child inside the slide box is the selection overlay.
    expect(slideBox.querySelector("[data-pptx-selection-overlay]")).not.toBeNull();
    expect(slideBox.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Insert image" })).not.toBeInTheDocument();
  });

  it("toggles the find bar from the ribbon and Ctrl+F (C6)", () => {
    renderEditor({ slides: [{ id: "s1" }] });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(screen.getByRole("search", { name: "Find in presentation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(screen.queryByRole("search", { name: "Find in presentation" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("application", { name: "PowerPoint slide canvas" }), { key: "f", ctrlKey: true });
    expect(screen.getByRole("search", { name: "Find in presentation" })).toBeInTheDocument();
  });

  it("returns focus to the Find trigger when the find bar closes (F9)", () => {
    renderEditor({ slides: [{ id: "s1" }] });
    const find = screen.getByRole("button", { name: "Find" });
    fireEvent.click(find);
    expect(screen.getByRole("search", { name: "Find in presentation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(screen.queryByRole("search", { name: "Find in presentation" })).not.toBeInTheDocument();
    // F9: focus returns to the control that opened the bar, not document.body.
    expect(document.activeElement).toBe(find);
  });

  it("returns focus to the Find trigger when Escape closes the find bar (F9)", () => {
    renderEditor({ slides: [{ id: "s1" }] });
    const find = screen.getByRole("button", { name: "Find" });
    fireEvent.click(find);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find text" }), { key: "Escape" });
    expect(screen.queryByRole("search", { name: "Find in presentation" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(find);
  });

  it("marks the tab-row Present toggle pressed while the audience show is open (C6, F-05)", () => {
    renderEditor({ slides: [{ id: "s1" }] });
    const toggle = screen.getByRole("button", { name: "Present" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "Slide show" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getAllByRole("button", { name: "End show" }).at(-1) as HTMLElement);
    expect(screen.queryByRole("dialog", { name: "Slide show" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "false");
  });

  it("starts the audience show from the first visible slide on the Slide Show tab (F-05)", () => {
    const onSlideSelect = vi.fn();
    renderEditor({ slides: [{ id: "s1", hidden: true }, { id: "s2" }, { id: "s3" }], selectedIndex: 2, onSlideSelect });
    fireEvent.click(screen.getByRole("tab", { name: "Slide Show" }));
    fireEvent.click(document.querySelector('[data-ribbon-item="show-from-start"]') as HTMLElement);
    expect(onSlideSelect).toHaveBeenCalledWith(1);
    expect(screen.getByRole("dialog", { name: "Slide show" })).toBeInTheDocument();
  });

  it("advances and goes back from the presenter controls", async () => {
    renderEditor({ slides: [{ id: "s1" }, { id: "s2" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    fireEvent.click(presenterViewItem());
    expect(screen.getByTestId("pptx-presenter-current")).toHaveTextContent("Current slide 1");
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    await waitFor(() => expect(screen.getByTestId("pptx-presenter-current")).toHaveTextContent("Current slide 2"));
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    await waitFor(() => expect(screen.getByTestId("pptx-presenter-current")).toHaveTextContent("Current slide 1"));
  });

  it("advances with the presenter nav keys and never exits on Space (F1)", async () => {
    renderEditor({ slides: [{ id: "s1" }, { id: "s2" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    fireEvent.click(presenterViewItem());
    expect(screen.getByTestId("pptx-presenter-current")).toHaveTextContent("Current slide 1");
    // ArrowRight advances the show (the presenter owns the nav contract now).
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("pptx-presenter-current")).toHaveTextContent("Current slide 2"));
    // F1: Space is a nav key on the presenter surface, never the exit control.
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("dialog", { name: "Presenter view" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByTestId("pptx-presenter-current")).toHaveTextContent("Current slide 1"));
  });

  it("exits the presenter on Escape and returns focus to the trigger", async () => {
    renderEditor({ slides: [{ id: "s1" }, { id: "s2" }], deck });
    await waitFor(() => expect(screen.getByText("Rendered title")).toBeInTheDocument());
    const trigger = presenterViewItem();
    // F2: fireEvent.click never moves focus in jsdom; focus the trigger for real
    // so the focus-return assertion tests the product behaviour, not the harness.
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Presenter view" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Presenter view" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("derives the side panel from the active ribbon tab and reaches every mapped panel (WIRE-PANEL-TABS)", () => {
    renderEditor({ slides: [{ id: "s1" }, { id: "s2" }] });
    // Home maps to no panel: no side surface is mounted until a panel tab is chosen.
    expect(document.querySelector("[data-pptx-panel-host]")).toBeNull();
    const expectPanel = (selector: string) => {
      const aside = document.querySelector("[data-pptx-panel-host]");
      expect(aside).not.toBeNull();
      expect(aside?.querySelector(selector)).not.toBeNull();
    };
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expectPanel("[data-pptx-insert-panel]");
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    expectPanel("[data-pptx-sorter-panel]");
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expectPanel("[data-pptx-notes-pane]");
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    expectPanel("[data-pptx-design-panel]");
    fireEvent.click(screen.getByRole("tab", { name: "Animations" }));
    expectPanel("[data-pptx-animations-panel]");
    fireEvent.click(screen.getByRole("tab", { name: "Transitions" }));
    expectPanel("[data-pptx-transitions-panel]");
    // A tab with no mapped panel (Slide Show) renders no side surface.
    fireEvent.click(screen.getByRole("tab", { name: "Slide Show" }));
    expect(document.querySelector("[data-pptx-panel-host]")).toBeNull();
  });

  it("keeps an explicitly supplied panelKind as the host override over the derived one (WIRE-PANEL-TABS)", () => {
    renderEditor({ slides: [{ id: "s1" }], panelKind: "notes" });
    // The override renders even while the active tab (Home) maps to no panel.
    expect(document.querySelector("[data-pptx-panel-host] [data-pptx-notes-pane]")).not.toBeNull();
    // Switching to another panel-bearing tab does not replace the host's choice.
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(document.querySelector("[data-pptx-panel-host] [data-pptx-notes-pane]")).not.toBeNull();
    expect(document.querySelector("[data-pptx-panel-host] [data-pptx-insert-panel]")).toBeNull();
  });

  it("mounts into one OfficeFrame with the rail inside, notes at the bottom and help in the status bar (F1/F9/F10)", () => {
    renderEditor({ slides: [{ id: "s1" }, { id: "s2" }] });
    const frames = document.querySelectorAll("[data-office-frame]");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.querySelector("[data-pptx-slide-rail]")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(document.querySelector('[data-pptx-panel-placement="bottom"] [data-pptx-notes-pane]')).not.toBeNull();
    const help = frames[0]?.querySelector("[data-pptx-status-help]");
    expect(help).not.toBeNull();
    fireEvent.click(help as Element);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens a contextual tab only while the matching object is selected (R4)", async () => {
    const { module } = tableRendererModule();
    render(<PptxEditor host={makeHost(vi.fn())} editorHandle={handle()} loadRendererModule={async () => module} slides={[{ id: "s1" }]} deck={deck} />);
    // The table fixture renders the real cell text "A1"; asserting it proves the
    // table node is actually painted (the contextual tab is gated on its selection).
    await waitFor(() => expect(screen.getByText("A1")).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: "Table Design" })).not.toBeInTheDocument();
    const overlay = screen.getByRole("application").querySelector("[data-pptx-selection-overlay]") as HTMLElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.pointerDown(overlay, { button: 0, clientX: 200, clientY: 120 });
    fireEvent.pointerUp(overlay, { button: 0, clientX: 200, clientY: 120 });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Table Design" })).toHaveAttribute("data-ribbon-contextual", "info"));
  });

});
