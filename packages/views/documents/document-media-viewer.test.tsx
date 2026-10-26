import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { useZoomCanvas } from "../editor/hooks/use-zoom-canvas";
import { ZoomControls } from "../editor/zoom-canvas";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentFileView } from "./document-file-view";
import { isImageDocument } from "./document-media-kind";

vi.mock("@uniwork/core/api/http", async (original) => {
  const { requestMock: transport } = await import("../test/request-mock");
  return {
    ...(await original<typeof import("@uniwork/core/api/http")>()),
    request: (...args: unknown[]) => transport(...args),
    requestBlob: (...args: unknown[]) => transport(...args),
  };
});

const { t } = initI18n();
const createUrl = vi.fn();
const revokeUrl = vi.fn();

function fileDocument(mime: string, filename: string, level = "edit"): Document {
  const parsed = DocumentSchema.parse({
    id: "d1",
    workspace_id: "ws1",
    kind: "file",
    title: filename,
    revision: "3",
    current_version: 2,
    my_level: level,
    file: {
      file_id: "f1",
      version_id: "v2",
      version: 2,
      filename,
      mime_type: mime,
      size_bytes: 482_133,
      checksum_sha256: "a".repeat(64),
    },
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
    system_kind: parsed.system_kind as Document["system_kind"],
  };
}

function mockBytes(type: string) {
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path.includes("/download") ? new Blob(["bytes"], { type }) : { versions: [], next_cursor: null }),
  );
}

function renderView(doc: Document, readonly = false) {
  return render(wrap(<DocumentFileView wsId="ws1" doc={doc} readonly={readonly} permissionNoticeShown />));
}

const origRequestFullscreen = HTMLElement.prototype.requestFullscreen;
const origExitFullscreen = window.document.exitFullscreen;

beforeEach(() => {
  requestMock.mockReset();
  createUrl.mockReset().mockReturnValue("blob:media");
  revokeUrl.mockReset();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = revokeUrl;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  HTMLElement.prototype.requestFullscreen = origRequestFullscreen;
  window.document.exitFullscreen = origExitFullscreen;
  Object.defineProperty(window.document, "fullscreenElement", { value: null, configurable: true });
  Object.defineProperty(window.document, "fullscreenEnabled", { value: false, configurable: true });
});

describe("isImageDocument", () => {
  it("opens image/* files in the viewer, and nothing else (video is out of scope)", () => {
    expect(isImageDocument(fileDocument("image/png", "a.png"))).toBe(true);
    expect(isImageDocument(fileDocument("image/svg+xml", "a.svg"))).toBe(true);
    expect(isImageDocument(fileDocument("video/mp4", "a.mp4"))).toBe(false);
    expect(isImageDocument(fileDocument("application/pdf", "a.pdf"))).toBe(false);
    expect(isImageDocument({ ...fileDocument("image/png", "a.png"), kind: "page" })).toBe(false);
  });
});

function installViewportSize(width = 1000, height = 600) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height);
}

function decodeImage(img: HTMLElement, width = 2000, height = 1000) {
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(img);
}

describe("ZoomControls slider opt-in", () => {
  function Harness({ slider }: { slider?: boolean }) {
    const canvas = useZoomCanvas({ content: { width: 1000, height: 600 } });
    return <ZoomControls canvas={canvas} slider={slider} />;
  }

  it("leaves default ZoomControls output unchanged without a slider, and renders the slider only when opted in", () => {
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("button", { name: t("editor.canvas.zoom_out") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("editor.canvas.zoom_in") })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    unmount();

    render(<Harness slider />);
    expect(screen.getByRole("group", { name: t("editor.canvas.zoom_level") })).toBeInTheDocument();
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "25");
    expect(slider).toHaveAttribute("max", "400");
    expect(slider).toHaveAttribute("step", "5");
  });
});

describe("DocumentMediaViewer", () => {
  it("shows the loading state with zoom controls disabled while the bytes are in flight", () => {
    requestMock.mockImplementation(() => new Promise(() => undefined));
    renderView(fileDocument("image/png", "ảnh.png"));

    expect(screen.getByRole("status")).toHaveTextContent(t("documents.media.loading"));
    expect(screen.getByRole("button", { name: t("editor.canvas.zoom_in") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("editor.canvas.zoom_out") })).toBeDisabled();
    expect(screen.getByRole("slider")).toBeDisabled();
  });

  it("shows an image on the shared zoom canvas with intent=view, and opens file facts in the popover", async () => {
    mockBytes("image/png");
    renderView(fileDocument("image/png", "ảnh.png"));

    const img = await screen.findByRole("img", { name: "ảnh.png" });
    expect(img).toHaveAttribute("src", "blob:media");
    expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/d1/download?intent=view", expect.anything());
    expect(screen.getByRole("application", { name: t("editor.image.canvas_label") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("editor.canvas.zoom_in") })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: t("editor.canvas.zoom_level") })).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.file.metadata_title") }));
    expect(await screen.findByText("image/png")).toBeInTheDocument();
    // The file commands live in the page menu, as they do beside an Office editor.
    expect(screen.queryByRole("button", { name: t("documents.file.download") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.file.new_version") })).toBeNull();
    // No Fullscreen in jsdom by default: the control is only offered where the browser has it.
    expect(screen.queryByRole("button", { name: t("documents.media.fullscreen_enter") })).toBeNull();
  });

  it("updates scale and percent when fit, actual size, zoom buttons, and the slider (including keyboard arrows) are used", async () => {
    installViewportSize(1000, 600);
    mockBytes("image/png");
    renderView(fileDocument("image/png", "ảnh.png"));

    const img = await screen.findByRole("img", { name: "ảnh.png" });
    decodeImage(img, 2000, 1000);

    // 2000x1000 in 1000x600 fits at 50%.
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.getByText(/2000 × 1000 px/)).toBeInTheDocument();
    const canvas = screen.getByRole("application", { name: t("editor.image.canvas_label") });
    const contentWrapper = canvas.firstElementChild as HTMLElement;
    expect(contentWrapper.style.transform).toContain("scale(0.5)");

    // Actual size (100%)
    fireEvent.click(screen.getByRole("button", { name: t("editor.canvas.zoom_actual") }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(contentWrapper.style.transform).toContain("scale(1)");

    // Zoom in (+20% step -> 120%)
    fireEvent.click(screen.getByRole("button", { name: t("editor.canvas.zoom_in") }));
    expect(screen.getByText("120%")).toBeInTheDocument();
    expect(contentWrapper.style.transform).toContain("scale(1.2)");

    // Slider keyboard arrow (+5% step -> 125%) and direct change (-> 175%)
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(contentWrapper.style.transform).toContain("scale(1.25)");

    fireEvent.change(slider, { target: { value: "175" } });
    expect(screen.getByText("175%")).toBeInTheDocument();
    expect(contentWrapper.style.transform).toContain("scale(1.75)");

    fireEvent.change(slider, { target: { value: "9999" } });
    expect(screen.getByText("400%")).toBeInTheDocument();
    expect(contentWrapper.style.transform).toContain("scale(4)");

    // Fit returns to 50%
    fireEvent.click(screen.getByRole("button", { name: t("editor.canvas.zoom_fit") }));
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(contentWrapper.style.transform).toContain("scale(0.5)");
  });

  it("revokes the object URL on unmount and fetches + revokes when the file version changes", async () => {
    createUrl.mockReturnValueOnce("blob:v2").mockReturnValueOnce("blob:v3");
    mockBytes("image/png");
    const v2 = fileDocument("image/png", "ảnh.png");
    const { rerender, unmount } = renderView(v2);

    expect(await screen.findByRole("img", { name: "ảnh.png" })).toHaveAttribute("src", "blob:v2");
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(revokeUrl).not.toHaveBeenCalled();

    const v3: Document = {
      ...v2,
      current_version: 3,
      file: { ...v2.file!, version_id: "v3", version: 3 },
    };
    rerender(wrap(<DocumentFileView wsId="ws1" doc={v3} readonly={false} permissionNoticeShown />));

    expect(await screen.findByRole("img", { name: "ảnh.png" })).toHaveAttribute("src", "blob:v3");
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/documents/d1/download?intent=view", expect.anything());
    expect(revokeUrl).toHaveBeenCalledWith("blob:v2");

    unmount();
    expect(revokeUrl).toHaveBeenCalledWith("blob:v3");
  });

  it("offers the full screen button only when document.fullscreenEnabled is true, hides file details in fullscreen, and toggles fullscreen", async () => {
    Object.defineProperty(window.document, "fullscreenEnabled", { value: true, configurable: true });
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = requestFullscreen;
    window.document.exitFullscreen = exitFullscreen;

    mockBytes("image/png");
    renderView(fileDocument("image/png", "ảnh.png"));
    await screen.findByRole("img", { name: "ảnh.png" });

    expect(screen.getByRole("button", { name: t("documents.file.metadata_title") })).toBeInTheDocument();
    const enterBtn = screen.getByRole("button", { name: t("documents.media.fullscreen_enter") });
    fireEvent.click(enterBtn);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    const viewerRoot = document.querySelector("[data-document-media-viewer='image']");
    Object.defineProperty(window.document, "fullscreenElement", { value: viewerRoot, configurable: true });
    fireEvent(window.document, new Event("fullscreenchange"));

    const exitBtn = await screen.findByRole("button", { name: t("documents.media.fullscreen_exit") });
    expect(screen.queryByRole("button", { name: t("documents.file.metadata_title") })).toBeNull();
    fireEvent.click(exitBtn);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);

    Object.defineProperty(window.document, "fullscreenElement", { value: null, configurable: true });
    fireEvent(window.document, new Event("fullscreenchange"));
    expect(await screen.findByRole("button", { name: t("documents.file.metadata_title") })).toBeInTheDocument();
  });

  it("offers a retry when the bytes do not arrive", async () => {
    requestMock.mockImplementation((path: string) =>
      path.includes("/download") ? Promise.reject(new ApiError("boom", "internal", 500)) : Promise.resolve({}),
    );
    renderView(fileDocument("image/png", "ảnh.png"));

    expect(await screen.findByText(t("documents.media.error_title"))).toBeInTheDocument();
    mockBytes("image/png");
    fireEvent.click(screen.getByRole("button", { name: t("documents.media.retry") }));
    expect(await screen.findByRole("img", { name: "ảnh.png" })).toBeInTheDocument();
  });

  it("falls back to the file card with the reason when the browser cannot decode the image", async () => {
    mockBytes("image/png");
    renderView(fileDocument("image/png", "hỏng.png"));

    fireEvent.error(await screen.findByRole("img", { name: "hỏng.png" }));

    expect(await screen.findByText(t("documents.media.unsupported_title"))).toBeInTheDocument();
    expect(screen.getByText("hỏng.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.file.download") })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "hỏng.png" })).toBeNull();
  });

  it("gives a view-only reader the viewer without the new-version command", async () => {
    mockBytes("image/png");
    renderView(fileDocument("image/png", "hỏng.png", "view"), true);
    expect(await screen.findByRole("img", { name: "hỏng.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.file.new_version") })).toBeNull();

    fireEvent.error(screen.getByRole("img", { name: "hỏng.png" }));
    expect(await screen.findByRole("button", { name: t("documents.file.download") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.file.new_version") })).toBeNull();
  });
});
