// B8e (UNI-927) - media + SmartArt + embedded fonts (engine half).
//
// Binds the three vendored pptx-ops content-add ops this area owns to one
// typed, validated op builder. The wire round registers `MediaEdit` as
// `PptxEdit` kinds in model.ts and calls the builder mechanically:
//
//   this.txn(buildMediaOps(this.opened, this.fitWidthPx, edit))
//
// Vendored contract (READ ONLY - never imported; cited for every field):
//   addMedia     packages/office-upstream/upstream/packages/pptx-ops/src/ops/insert-ops.ts:286-322
//                (validate :288-308 -> resolveSlide + reqRect + fillExtFromDataUrl
//                + reqBytes + kind must be "video"|"audio" + non-empty ext, and a
//                poster given must carry bytes and a non-empty ext; apply
//                :309-321 -> addMedia(opened, index, {kind, bytes, ext, offset,
//                optional name, optional poster}) at
//                packages/pptx-engine/src/media-insert.ts:167, which writes the
//                media + poster parts, the dual media relationships and the
//                <p:pic> fragment. Engine mime table: media-insert.ts:30-43;
//                NewMediaOptions: media-insert.ts:154-165.)
//   addSmartArt  insert-ops.ts:264-283
//                (validate :266-271 -> resolveSlide + reqRect + layout must be a
//                string and items an array; apply :273-281 -> addSmartArt at
//                packages/pptx-engine/src/smartart.ts:61 with
//                NewSmartArtOptions {layout, items, offset} (smartart.ts:18-22).
//                Layout vocabulary: smartart-layout.ts:7-8, one child shape per
//                item, node count 1..8 (smartart-layout.ts:37).)
//   addModel3d   insert-ops.ts:324-344
//                (validate :326-331 -> resolveSlide + reqRect + reqBytes +
//                non-empty ext; apply :332-343 -> addModel3d at
//                packages/pptx-engine/src/media-insert.ts:240 with
//                NewModel3dOptions {bytes, ext, optional poster, offset,
//                optional name} (media-insert.ts:225-233).)
//
// Embedded fonts: packages/pptx-engine/src/embedded-fonts.ts is an engine
// read/parse helper only (listEmbeddedFonts / eotToSfnt / stripStaleEmbeddedFonts
// / staleEmbeddedTypefaces). The vendored pptx-ops registry exposes NO
// embedded-font op, so this module deliberately binds none - it is recorded as
// an engine-only capability in worker-B8e.md, never invented as an op.
//
// Pixel -> EMU: media/SmartArt inserts carry a viewport-pixel rect
// (xPx/yPx/wPx/hPx) and buildMediaOps converts it with
// makePxToEmu(opened, fitWidthPx) - the same scale the canvas uses. Ops carry
// EMU only (offset {x, y, cx, cy}); bytes/ext/poster pass through by reference.
//
// The builder never imports the vendored media-insert module (no node:zlib
// deflate here): poster PNG compression stays inside the vendored ops path.
import { PptxEngineError, type OpenedPptxLike, type PptxOp } from "../engine";
import { makePxToEmu } from "../model";

/** Media kinds the vendored addMedia op accepts (insert-ops.ts:293). */
export const MEDIA_KINDS = ["video", "audio"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** SmartArt layouts the vendored engine lays out (smartart-layout.ts:7-8);
 * the gallery renders from this list. */
export const SMARTART_LAYOUT_NAMES = [
  "list",
  "process",
  "cycle",
  "hierarchy",
  "pyramid",
  "matrix",
  "venn",
] as const;
export type SmartArtLayoutName = (typeof SMARTART_LAYOUT_NAMES)[number];

/** Poster frame bytes (NewMediaOptions.poster / NewModel3dOptions.poster,
 * media-insert.ts:158, :230) - passed through untouched. */
export interface MediaPoster {
  bytes: Uint8Array;
  ext: string;
}

/** The edit kinds this module builds (registered as PptxEdit kinds by the
 * wire round):
 *  - add_media    -> vendored `addMedia` (video/audio + EMU rect + ext/bytes +
 *                    optional poster/name);
 *  - add_smartart -> vendored `addSmartArt` (layout + items + EMU rect);
 *  - add_model3d  -> vendored `addModel3d` (glb/gltf + EMU rect + ext/bytes +
 *                    optional poster/name). */
export type MediaEdit =
  | {
      op: "add_media";
      slideIndex: number;
      kind: MediaKind;
      ext: string;
      bytes: Uint8Array;
      /** Insert rect in viewport pixels; converted to EMU with makePxToEmu. */
      xPx: number;
      yPx: number;
      wPx: number;
      hPx: number;
      poster?: MediaPoster;
      name?: string;
    }
  | {
      op: "add_smartart";
      slideIndex: number;
      layout: SmartArtLayoutName;
      /** Node text, 1..8 items (one child shape each). */
      items: string[];
      xPx: number;
      yPx: number;
      wPx: number;
      hPx: number;
    }
  | {
      op: "add_model3d";
      slideIndex: number;
      ext: string;
      bytes: Uint8Array;
      xPx: number;
      yPx: number;
      wPx: number;
      hPx: number;
      poster?: MediaPoster;
      name?: string;
    };

function fail(code: string, message: string): never {
  throw new PptxEngineError(code, message);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const requireSlide = (opened: OpenedPptxLike, slideIndex: number, op: string): void => {
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || !opened.deck.slides[slideIndex]) {
    fail("media_no_slide", op + ": slide index " + String(slideIndex) + " does not exist");
  }
};

const requireKind = (value: unknown): MediaKind => {
  if (typeof value !== "string" || !(MEDIA_KINDS as readonly string[]).includes(value)) {
    fail("media_bad_kind", 'kind must be "video" or "audio"');
  }
  return value as MediaKind;
};

const requireExt = (value: unknown, op: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    fail("media_bad_ext", op + ": ext must be a non-empty extension string (mp4/mp3/glb/...)");
  }
  return value;
};

const requireBytes = (value: unknown, field: string, code = "media_bad_bytes"): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    fail(code, field + " must be a non-empty Uint8Array");
  }
  return value;
};

const requireRect = (edit: {
  xPx: unknown;
  yPx: unknown;
  wPx: unknown;
  hPx: unknown;
}): void => {
  if (!isFiniteNumber(edit.xPx) || edit.xPx < 0) fail("media_bad_rect", "xPx must be a finite number >= 0");
  if (!isFiniteNumber(edit.yPx) || edit.yPx < 0) fail("media_bad_rect", "yPx must be a finite number >= 0");
  if (!isFiniteNumber(edit.wPx) || edit.wPx <= 0) fail("media_bad_rect", "wPx must be a positive finite number");
  if (!isFiniteNumber(edit.hPx) || edit.hPx <= 0) fail("media_bad_rect", "hPx must be a positive finite number");
};

/** Poster frame: both bytes and a non-empty ext, mirroring insert-ops.ts:298-307. */
const buildPoster = (poster: MediaPoster | undefined): MediaPoster | undefined => {
  if (poster === undefined) return undefined;
  if (typeof poster !== "object" || poster === null) {
    fail("media_bad_poster", "poster must be { bytes: Uint8Array, ext: string }");
  }
  if (typeof poster.ext !== "string" || !poster.ext.trim()) {
    fail("media_bad_poster", "poster.ext must be a non-empty extension string");
  }
  return { bytes: requireBytes(poster.bytes, "poster.bytes", "media_bad_poster"), ext: poster.ext };
};

const optionalName = (name: string | undefined): string | undefined => {
  if (name === undefined) return undefined;
  if (typeof name !== "string" || !name) {
    fail("media_bad_name", "name must be a non-empty string when given");
  }
  return name;
};

const requireSmartArtItems = (items: unknown): string[] => {
  if (!Array.isArray(items) || items.length === 0) {
    fail("media_bad_smartart", "items must be a non-empty array of node texts (1..8)");
  }
  if (items.length > 8) {
    fail("media_bad_smartart", "items must hold at most 8 node texts (the engine lays out 1..8)");
  }
  if (items.some((item) => typeof item !== "string")) {
    fail("media_bad_smartart", "every items[] entry must be a string");
  }
  return items as string[];
};

const requireSmartArtLayout = (value: unknown): SmartArtLayoutName => {
  if (typeof value !== "string" || !(SMARTART_LAYOUT_NAMES as readonly string[]).includes(value)) {
    fail("media_bad_smartart", "layout must be one of: " + SMARTART_LAYOUT_NAMES.join(", "));
  }
  return value as SmartArtLayoutName;
};

const emuRect = (
  toEmu: (px: number) => number,
  edit: { xPx: number; yPx: number; wPx: number; hPx: number },
): { x: number; y: number; cx: number; cy: number } => ({
  x: toEmu(edit.xPx),
  y: toEmu(edit.yPx),
  cx: toEmu(edit.wPx),
  cy: toEmu(edit.hPx),
});

/** Build the one vendored op an edit maps to; targets and fields are validated
 * here so the wire round stays a mechanical txn(buildMediaOps(...)) call. */
export function buildMediaOps(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: MediaEdit,
): PptxOp[] {
  switch (edit.op) {
    case "add_media":
      return [buildAddMedia(opened, fitWidthPx, edit)];
    case "add_smartart":
      return [buildAddSmartArt(opened, fitWidthPx, edit)];
    case "add_model3d":
      return [buildAddModel3d(opened, fitWidthPx, edit)];
  }
}

function buildAddMedia(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: Extract<MediaEdit, { op: "add_media" }>,
): PptxOp {
  requireSlide(opened, edit.slideIndex, "add_media");
  const kind = requireKind(edit.kind);
  const ext = requireExt(edit.ext, "add_media");
  const bytes = requireBytes(edit.bytes, "bytes");
  const poster = buildPoster(edit.poster);
  requireRect(edit);
  const name = optionalName(edit.name);
  const toEmu = makePxToEmu(opened, fitWidthPx);
  return {
    op: "addMedia",
    target: { slide: edit.slideIndex },
    kind,
    bytes,
    ext,
    offset: emuRect(toEmu, edit),
    ...(name !== undefined ? { name } : {}),
    ...(poster !== undefined ? { poster } : {}),
  };
}

function buildAddSmartArt(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: Extract<MediaEdit, { op: "add_smartart" }>,
): PptxOp {
  requireSlide(opened, edit.slideIndex, "add_smartart");
  const layout = requireSmartArtLayout(edit.layout);
  const items = requireSmartArtItems(edit.items);
  requireRect(edit);
  const toEmu = makePxToEmu(opened, fitWidthPx);
  return {
    op: "addSmartArt",
    target: { slide: edit.slideIndex },
    layout,
    items,
    offset: emuRect(toEmu, edit),
  };
}

function buildAddModel3d(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: Extract<MediaEdit, { op: "add_model3d" }>,
): PptxOp {
  requireSlide(opened, edit.slideIndex, "add_model3d");
  const ext = requireExt(edit.ext, "add_model3d");
  const bytes = requireBytes(edit.bytes, "bytes");
  const poster = buildPoster(edit.poster);
  requireRect(edit);
  const name = optionalName(edit.name);
  const toEmu = makePxToEmu(opened, fitWidthPx);
  return {
    op: "addModel3d",
    target: { slide: edit.slideIndex },
    bytes,
    ext,
    offset: emuRect(toEmu, edit),
    ...(poster !== undefined ? { poster } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}