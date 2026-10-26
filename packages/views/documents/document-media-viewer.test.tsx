import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
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

beforeEach(() => {
  requestMock.mockReset();
  createUrl.mockReset().mockReturnValue("blob:media");
  revokeUrl.mockReset();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = revokeUrl;
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("isImageDocument", () => {
  it("opens image/* files in the viewer, and nothing else (video is out of scope)", () => {
    expect(isImageDocument(fileDocument("image/png", "a.png"))).toBe(true);
    expect(isImageDocument(fileDocument("image/svg+xml", "a.svg"))).toBe(true);
    expect(isImageDocument(fileDocument("video/mp4", "a.mp4"))).toBe(false);
    expect(isImageDocument(fileDocument("application/pdf", "a.pdf"))).toBe(false);
    expect(isImageDocument({ ...fileDocument("image/png", "a.png"), kind: "page" })).toBe(false);
  });
});

describe("DocumentMediaViewer", () => {
  it("shows an image on the shared zoom canvas, with the card's facts one click away", async () => {
    mockBytes("image/png");
    renderView(fileDocument("image/png", "ảnh.png"));

    const img = await screen.findByRole("img", { name: "ảnh.png" });
    expect(img).toHaveAttribute("src", "blob:media");
    expect(screen.getByRole("application", { name: t("editor.image.canvas_label") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("editor.canvas.zoom_in") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.file.metadata_title") })).toBeInTheDocument();
    // The file commands live in the page menu, as they do beside an Office editor.
    expect(screen.queryByRole("button", { name: t("documents.file.download") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.file.new_version") })).toBeNull();
    // No Fullscreen in jsdom: the control is only offered where the browser has it.
    expect(screen.queryByRole("button", { name: t("documents.media.fullscreen_enter") })).toBeNull();
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
