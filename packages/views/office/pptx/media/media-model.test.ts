// B8ui (UNI-927) - pure tests for the Media panel model.
import { describe, expect, it } from "vitest";
import {
  PPTX_MEDIA_AUDIO_EXTS,
  PPTX_MEDIA_VIDEO_EXTS,
  buildAddMediaEdit,
  buildRemoveMediaEdit,
  buildReplaceMediaEdit,
  defaultMediaBox,
  isPosterExt,
  mediaExtFromName,
  mediaKindFromExt,
  validateMediaBox,
  validateMediaBytes,
  validateMediaExt,
  validatePoster,
} from "./media-model";

const bytes = (n = 4): Uint8Array => new Uint8Array([1, 2, 3, 4].slice(0, n));

describe("media extension vocabulary", () => {
  it("maps every vendored video/audio extension to its kind", () => {
    for (const ext of PPTX_MEDIA_VIDEO_EXTS) expect(mediaKindFromExt(ext), ext).toBe("video");
    for (const ext of PPTX_MEDIA_AUDIO_EXTS) expect(mediaKindFromExt(ext), ext).toBe("audio");
  });

  it("returns null for an extension the engine has no mime for", () => {
    expect(mediaKindFromExt("pptx")).toBeNull();
    expect(mediaKindFromExt("glb")).toBeNull();
    expect(validateMediaExt("glb")).toEqual({
      ok: false,
      code: "media_unsupported_ext",
      message: "glb is not a media format the engine can embed",
    });
  });

  it("refuses a blank or non-string extension with the engine's code", () => {
    expect(validateMediaExt("").ok).toBe(false);
    expect(validateMediaExt(undefined).ok).toBe(false);
    expect(validateMediaExt(7)).toMatchObject({ code: "media_bad_ext" });
  });

  it("reads the extension from a file name, lower-cased", () => {
    expect(mediaExtFromName("clip.MP4")).toBe("mp4");
    expect(mediaExtFromName("noext")).toBeNull();
    expect(mediaExtFromName("trailing.")).toBeNull();
  });

  it("knows the poster image extensions the picture op accepts", () => {
    expect(isPosterExt("PNG")).toBe(true);
    expect(isPosterExt("webp")).toBe(true);
    expect(isPosterExt("mp4")).toBe(false);
  });
});

describe("buildAddMediaEdit", () => {
  it("builds the add_media union member with the default kind box", () => {
    const built = buildAddMediaEdit({ slideIndex: 1, kind: "video", ext: "MP4", bytes: bytes() });
    expect(built).toEqual({
      ok: true,
      value: {
        op: "add_media",
        slideIndex: 1,
        kind: "video",
        ext: "mp4",
        bytes: bytes(),
        ...defaultMediaBox("video"),
      },
    });
  });

  it("gives audio a smaller default frame than video", () => {
    expect(defaultMediaBox("audio").wPx).toBeLessThan(defaultMediaBox("video").wPx);
  });

  it("carries an explicit poster and name", () => {
    const built = buildAddMediaEdit({
      slideIndex: 0,
      kind: "audio",
      ext: "mp3",
      bytes: bytes(),
      poster: { bytes: bytes(), ext: "PNG" },
      name: "intro.mp3",
    });
    expect(built.ok && built.value.poster).toEqual({ bytes: bytes(), ext: "png" });
    expect(built.ok && built.value.name).toBe("intro.mp3");
  });

  it("refuses a kind that disagrees with the extension", () => {
    expect(buildAddMediaEdit({ slideIndex: 0, kind: "video", ext: "mp3", bytes: bytes() })).toMatchObject({
      ok: false,
      code: "media_bad_kind",
    });
  });

  it("refuses an out-of-vocabulary kind", () => {
    expect(
      buildAddMediaEdit({ slideIndex: 0, kind: "model" as never, ext: "mp4", bytes: bytes() }),
    ).toMatchObject({ ok: false, code: "media_bad_kind" });
  });

  it("refuses a bad slide index, empty bytes, a bad box and a bad poster", () => {
    expect(buildAddMediaEdit({ slideIndex: -1, kind: "video", ext: "mp4", bytes: bytes() })).toMatchObject({
      code: "media_no_slide",
    });
    expect(buildAddMediaEdit({ slideIndex: 0, kind: "video", ext: "mp4", bytes: new Uint8Array() })).toMatchObject({
      code: "media_bad_bytes",
    });
    expect(
      buildAddMediaEdit({ slideIndex: 0, kind: "video", ext: "mp4", bytes: bytes(), box: { xPx: 0, yPx: 0, wPx: 0, hPx: 10 } }),
    ).toMatchObject({ code: "media_bad_rect" });
    expect(
      buildAddMediaEdit({ slideIndex: 0, kind: "video", ext: "mp4", bytes: bytes(), poster: { bytes: bytes(), ext: "mp4" } }),
    ).toMatchObject({ code: "media_bad_poster" });
  });

  it("refuses an empty name", () => {
    expect(
      buildAddMediaEdit({ slideIndex: 0, kind: "video", ext: "mp4", bytes: bytes(), name: "" }),
    ).toMatchObject({ code: "media_bad_name" });
  });
});

describe("buildReplaceMediaEdit / buildRemoveMediaEdit", () => {
  it("builds replace_picture for the selected element's poster", () => {
    expect(buildReplaceMediaEdit({ slideIndex: 2, elementId: "pic1", bytes: bytes(), ext: "JPEG" })).toEqual({
      ok: true,
      value: { op: "replace_picture", slideIndex: 2, elementId: "pic1", bytes: bytes(), ext: "jpeg" },
    });
  });

  it("refuses a non-raster replacement extension", () => {
    expect(buildReplaceMediaEdit({ slideIndex: 0, elementId: "pic1", bytes: bytes(), ext: "mp4" })).toMatchObject({
      ok: false,
      code: "media_unsupported_ext",
    });
  });

  it("refuses a missing element or slide", () => {
    expect(buildReplaceMediaEdit({ slideIndex: 0, elementId: "", bytes: bytes(), ext: "png" })).toMatchObject({
      code: "media_no_element",
    });
    expect(buildReplaceMediaEdit({ slideIndex: -1, elementId: "p", bytes: bytes(), ext: "png" })).toMatchObject({
      code: "media_no_slide",
    });
  });

  it("builds delete_element for the selected media element", () => {
    expect(buildRemoveMediaEdit({ slideIndex: 3, elementId: "pic9" })).toEqual({
      ok: true,
      value: { op: "delete_element", slideIndex: 3, elementId: "pic9" },
    });
    expect(buildRemoveMediaEdit({ slideIndex: 3, elementId: "" })).toMatchObject({ code: "media_no_element" });
  });
});

describe("validators", () => {
  it("validates a box, bytes and a poster directly", () => {
    expect(validateMediaBox({ xPx: 0, yPx: 0, wPx: 1, hPx: 1 }).ok).toBe(true);
    expect(validateMediaBox({ xPx: -1, yPx: 0, wPx: 1, hPx: 1 }).ok).toBe(false);
    expect(validateMediaBytes(bytes()).ok).toBe(true);
    expect(validateMediaBytes(new Uint8Array()).ok).toBe(false);
    expect(validatePoster({ bytes: bytes(), ext: "png" }).ok).toBe(true);
    expect(validatePoster({ bytes: new Uint8Array(), ext: "png" })).toMatchObject({ code: "media_bad_poster" });
  });
});