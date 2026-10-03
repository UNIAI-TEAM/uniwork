import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { clearPptxThumbnailCache } from "./canvas/use-pptx-thumbnails";
import { run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
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
    renderEditor({ slides: [{ id: "s1" }] });
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Text" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shape / image" })).toBeDisabled();
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
    await waitFor(() => expect(buildRenderSlide).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Slide 2" }));
    await waitFor(() => expect(buildRenderSlide).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ slideNo: 2 })));
    expect(buildRenderSlide).toHaveBeenCalledTimes(2);
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

  it("opens presenter mode over the selected slide without another editor", () => {
    const call = vi.fn();
    const view = render(<PptxEditor host={makeHost(call)} editorHandle={handle()} loadRendererModule={async () => fakeRendererModule().module} slides={[{ id: "s1", label: "Intro" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Presenter" }));
    expect(screen.getByRole("dialog", { name: "Presenter view" })).toBeInTheDocument();
    expect(screen.getAllByText("Intro").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Close presenter" }));
    expect(screen.queryByRole("dialog", { name: "Presenter view" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("disposes the one editor handle when the view unmounts", async () => {
    const editorHandle = handle();
    const view = render(<PptxEditor host={makeHost(vi.fn())} editorHandle={editorHandle} loadRendererModule={async () => fakeRendererModule().module} slides={[{ id: "s1" }]} />);
    view.unmount();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(editorHandle.dispose).toHaveBeenCalledTimes(1);
  });
});
