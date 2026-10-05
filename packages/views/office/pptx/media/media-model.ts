/**
 * Media panel model (B8ui, UNI-927) - the pure half of the Media tab.
 *
 * Everything here is data or a pure function, so the panel stays presentational
 * and the contract the serialized UI-wire round binds is testable without React.
 *
 * Binding contract (committed B8e engine half,
 * `packages/office-engine/src/pptx/edits/media-edits.ts`): this panel emits
 * exactly that module's `add_media` union member for an insert, so the wire
 * round is mechanical:
 *   insert  -> MediaEdit `add_media`       { slideIndex, kind, ext, bytes, xPx, yPx, wPx, hPx, poster?, name? }
 *   replace -> PptxEdit `replace_picture`  { slideIndex, elementId, bytes, ext, keepSrcRect? }
 *   remove  -> PptxEdit `delete_element`   { slideIndex, elementId }
 *
 * A media element is written by the vendored `addMedia` as a `<p:pic>` whose
 * blipFill is the poster frame (`media-insert.ts:203-220`), and the vendored
 * pptx-ops registry has NO media-replace op (only `replacePicture`, which is
 * gated to the raster IMAGE_MIME set, `insert.ts:424-432`). So "replace" here
 * swaps the selected media element's image bytes - its poster frame - through
 * the registered `replace_picture`, and the model refuses a non-raster ext with
 * a typed refusal instead of sending an op the vendored executor would drop.
 *
 * Refusals mirror the engine builder's own guard so the panel can explain a
 * refusal BEFORE an edit reaches the session: the same stable codes
 * (`media_no_slide`, `media_bad_kind`, `media_bad_ext`, `media_bad_bytes`,
 * `media_bad_poster`, `media_bad_rect`, `media_bad_name`) and the same message
 * shape a `PptxEngineError` carries, plus the two panel-only codes
 * (`media_unsupported_ext`, `media_no_element`).
 *
 * Extensions come from the vendored engine mime tables verbatim:
 * video/audio `media-insert.ts:30-43`, poster images `insert.ts:424-432`.
 */
import type { MediaEdit, PptxEdit } from "@uniwork/office-engine/pptx";

/** Media kinds the vendored `addMedia` op accepts (`insert-ops.ts:293`). */
export const PPTX_MEDIA_KINDS = ["video", "audio"] as const;
export type PptxMediaKind = (typeof PPTX_MEDIA_KINDS)[number];

/** Video extensions the vendored `MEDIA_MIME` table maps (`media-insert.ts:31-35`). */
export const PPTX_MEDIA_VIDEO_EXTS: readonly string[] = ["mp4", "m4v", "mov", "webm", "avi"];
/** Audio extensions the vendored `MEDIA_MIME` table maps (`media-insert.ts:36-40`). */
export const PPTX_MEDIA_AUDIO_EXTS: readonly string[] = ["mp3", "wav", "m4a", "aac", "ogg"];
/** Poster-frame extensions the vendored `IMAGE_MIME` table accepts (`insert.ts:424-432`). */
export const PPTX_MEDIA_POSTER_EXTS: readonly string[] = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff"];

/** `accept` attributes for the file pickers. */
export const PPTX_MEDIA_VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-msvideo";
export const PPTX_MEDIA_AUDIO_ACCEPT = "audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg";
export const PPTX_MEDIA_POSTER_ACCEPT = "image/png,image/jpeg,image/gif,image/bmp,image/webp,image/tiff";

/** Insert frame in viewport px (the engine converts with makePxToEmu). */
export interface PptxMediaBox {
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
}

/** Video reads wider than audio, which is usually a compact speaker chip. */
export const PPTX_MEDIA_VIDEO_BOX: PptxMediaBox = { xPx: 100, yPx: 80, wPx: 320, hPx: 200 };
export const PPTX_MEDIA_AUDIO_BOX: PptxMediaBox = { xPx: 100, yPx: 80, wPx: 240, hPx: 160 };

/** Default frame for a newly inserted media element of `kind`. */
export function defaultMediaBox(kind: PptxMediaKind): PptxMediaBox {
  return kind === "audio" ? { ...PPTX_MEDIA_AUDIO_BOX } : { ...PPTX_MEDIA_VIDEO_BOX };
}

/** Poster frame bytes (`NewMediaOptions.poster`, `media-insert.ts:158`). */
export interface PptxMediaPoster {
  bytes: Uint8Array;
  ext: string;
}

/** The edit kinds this model builds, extracted from the real engine unions so a
 * drift in either breaks this file loudly. */
export type PptxMediaAddEdit = Extract<MediaEdit, { op: "add_media" }>;
export type PptxMediaReplaceEdit = Extract<PptxEdit, { op: "replace_picture" }>;
export type PptxMediaRemoveEdit = Extract<PptxEdit, { op: "delete_element" }>;
export type PptxMediaEdit = PptxMediaAddEdit | PptxMediaReplaceEdit | PptxMediaRemoveEdit;

/** The engine's refusal codes this model can produce, plus the two panel-only ones. */
export type PptxMediaRefusalCode =
  | "media_no_slide"
  | "media_bad_kind"
  | "media_bad_ext"
  | "media_bad_bytes"
  | "media_bad_poster"
  | "media_bad_rect"
  | "media_bad_name"
  | "media_unsupported_ext"
  | "media_no_element";

/** A refusal in the shape a `PptxEngineError` carries (code + message). */
export interface PptxMediaRefusal {
  code: PptxMediaRefusalCode;
  message: string;
}

/** Result of a validated build: the edit, or the engine's refusal shape. */
export type PptxMediaValidation<T> = { ok: true; value: T } | ({ ok: false } & PptxMediaRefusal);

const refuse = <T>(code: PptxMediaRefusalCode, message: string): PptxMediaValidation<T> => ({ ok: false, code, message });

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isFiniteNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Lower-case extension from a file name without the dot, or null when absent. */
export function mediaExtFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** The media kind a file extension belongs to, or null when the engine has no mime for it. */
export function mediaKindFromExt(ext: string): PptxMediaKind | null {
  const lower = ext.trim().toLowerCase();
  if (PPTX_MEDIA_VIDEO_EXTS.includes(lower)) return "video";
  if (PPTX_MEDIA_AUDIO_EXTS.includes(lower)) return "audio";
  return null;
}

/** True when `ext` is a poster-frame image the registered picture op accepts. */
export function isPosterExt(ext: string): boolean {
  return PPTX_MEDIA_POSTER_EXTS.includes(ext.trim().toLowerCase());
}

/** An extension the vendored media mime table maps, and the kind it maps to. */
export function validateMediaExt(ext: unknown): PptxMediaValidation<PptxMediaKind> {
  if (typeof ext !== "string" || !ext.trim()) {
    return refuse("media_bad_ext", "ext must be a non-empty extension string (mp4/mp3/...)");
  }
  const kind = mediaKindFromExt(ext);
  if (!kind) {
    return refuse("media_unsupported_ext", ext + " is not a media format the engine can embed");
  }
  return { ok: true, value: kind };
}

/** A positive finite viewport-pixel frame (mirrors `media_bad_rect`). */
export function validateMediaBox(box: PptxMediaBox): PptxMediaValidation<PptxMediaBox> {
  if (!isFiniteNum(box.xPx) || box.xPx < 0) return refuse("media_bad_rect", "xPx must be a finite number >= 0");
  if (!isFiniteNum(box.yPx) || box.yPx < 0) return refuse("media_bad_rect", "yPx must be a finite number >= 0");
  if (!isFiniteNum(box.wPx) || box.wPx <= 0) return refuse("media_bad_rect", "wPx must be a positive finite number");
  if (!isFiniteNum(box.hPx) || box.hPx <= 0) return refuse("media_bad_rect", "hPx must be a positive finite number");
  return { ok: true, value: box };
}

/** Bytes must be a non-empty `Uint8Array` (`media_bad_bytes`). */
export function validateMediaBytes(bytes: unknown, field = "bytes"): PptxMediaValidation<Uint8Array> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return refuse("media_bad_bytes", field + " must be a non-empty Uint8Array");
  }
  return { ok: true, value: bytes };
}

/** A poster needs both bytes and a raster extension the picture op accepts. */
export function validatePoster(poster: PptxMediaPoster): PptxMediaValidation<PptxMediaPoster> {
  if (typeof poster !== "object" || poster === null) {
    return refuse("media_bad_poster", "poster must be { bytes: Uint8Array, ext: string }");
  }
  if (typeof poster.ext !== "string" || !poster.ext.trim()) {
    return refuse("media_bad_poster", "poster.ext must be a non-empty extension string");
  }
  if (!isPosterExt(poster.ext)) {
    return refuse("media_bad_poster", poster.ext + " is not a poster image format (png/jpg/webp/...)");
  }
  const bytes = validateMediaBytes(poster.bytes, "poster.bytes");
  if (!bytes.ok) return refuse("media_bad_poster", bytes.message);
  return { ok: true, value: { bytes: bytes.value, ext: poster.ext.trim().toLowerCase() } };
}

/** One `add_media` request, in the panel's own vocabulary. */
export interface PptxMediaAddRequest {
  slideIndex: number;
  kind: PptxMediaKind;
  ext: string;
  bytes: Uint8Array;
  box?: PptxMediaBox;
  poster?: PptxMediaPoster;
  name?: string;
}

/** `add_media` for an audio/video insert; validation order mirrors the engine builder. */
export function buildAddMediaEdit(request: PptxMediaAddRequest): PptxMediaValidation<PptxMediaAddEdit> {
  if (!isInt(request.slideIndex) || request.slideIndex < 0) {
    return refuse("media_no_slide", "a media insert needs a slide index >= 0");
  }
  if (!(PPTX_MEDIA_KINDS as readonly string[]).includes(request.kind)) {
    return refuse("media_bad_kind", 'kind must be "video" or "audio"');
  }
  const ext = validateMediaExt(request.ext);
  if (!ext.ok) return ext;
  if (ext.value !== request.kind) {
    return refuse("media_bad_kind", request.ext + " is a " + ext.value + " format but kind is " + request.kind);
  }
  const bytes = validateMediaBytes(request.bytes);
  if (!bytes.ok) return bytes;
  let poster: PptxMediaPoster | undefined;
  if (request.poster !== undefined) {
    const checked = validatePoster(request.poster);
    if (!checked.ok) return checked;
    poster = checked.value;
  }
  const box = validateMediaBox(request.box ?? defaultMediaBox(request.kind));
  if (!box.ok) return box;
  if (request.name !== undefined && (typeof request.name !== "string" || !request.name)) {
    return refuse("media_bad_name", "name must be a non-empty string when given");
  }
  return {
    ok: true,
    value: {
      op: "add_media",
      slideIndex: request.slideIndex,
      kind: request.kind,
      ext: request.ext.trim().toLowerCase(),
      bytes: bytes.value,
      ...box.value,
      ...(poster !== undefined ? { poster } : {}),
      ...(request.name !== undefined ? { name: request.name } : {}),
    },
  };
}

/** One poster-replace request: the media element plus the new image bytes. */
export interface PptxMediaReplaceRequest {
  slideIndex: number;
  elementId: string;
  bytes: Uint8Array;
  ext: string;
  keepSrcRect?: boolean;
}

/** `replace_picture` for the selected media element's poster frame. */
export function buildReplaceMediaEdit(request: PptxMediaReplaceRequest): PptxMediaValidation<PptxMediaReplaceEdit> {
  if (!isInt(request.slideIndex) || request.slideIndex < 0) {
    return refuse("media_no_slide", "a media replace needs a slide index >= 0");
  }
  if (typeof request.elementId !== "string" || !request.elementId) {
    return refuse("media_no_element", "a media replace needs an element id");
  }
  const ext = typeof request.ext === "string" ? request.ext.trim().toLowerCase() : "";
  if (!ext || !isPosterExt(ext)) {
    return refuse("media_unsupported_ext", (ext || String(request.ext)) + " is not a poster image format the replace op accepts");
  }
  const bytes = validateMediaBytes(request.bytes);
  if (!bytes.ok) return bytes;
  return {
    ok: true,
    value: {
      op: "replace_picture",
      slideIndex: request.slideIndex,
      elementId: request.elementId,
      bytes: bytes.value,
      ext,
      ...(request.keepSrcRect === true ? { keepSrcRect: true } : {}),
    },
  };
}

/** One remove request: the media element to delete from the slide. */
export interface PptxMediaRemoveRequest {
  slideIndex: number;
  elementId: string;
}

/** `delete_element` for the selected media element. */
export function buildRemoveMediaEdit(request: PptxMediaRemoveRequest): PptxMediaValidation<PptxMediaRemoveEdit> {
  if (!isInt(request.slideIndex) || request.slideIndex < 0) {
    return refuse("media_no_slide", "a media remove needs a slide index >= 0");
  }
  if (typeof request.elementId !== "string" || !request.elementId) {
    return refuse("media_no_element", "a media remove needs an element id");
  }
  return { ok: true, value: { op: "delete_element", slideIndex: request.slideIndex, elementId: request.elementId } };
}