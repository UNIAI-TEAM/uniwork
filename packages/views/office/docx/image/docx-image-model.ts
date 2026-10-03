// DOCX image editing model — pure helpers shared by the image layer, inspector
// and insert dialog. No editor and no React here; the TipTap glue lives in
// ./docx-image-commands and the byte/canvas work stays behind explicit
// functions so the save path (pmDocToSavePlan) is the only writer.
import { DOCX_IMAGE_WRAPS, type DocxImageWrap } from "@uniwork/office-engine/docx";

export const EMU_PER_PX = 9525;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Default insert width — genoffice parity (ribbon-tabs.tsx MAX_IMAGE_WIDTH_PX). */
export const MAX_IMAGE_WIDTH_PX = 620;
export const MIN_IMAGE_PX = 1;
export const MAX_IMAGE_PX = 10000;

export type DocxImageMime = "image/png" | "image/jpeg" | "image/gif";
export type DocxImageAlign = "left" | "center" | "right";
export type DocxImagePositionH = "left" | "center" | "right";
export type DocxImagePositionV = "top" | "center" | "bottom";

const IMAGE_MIME_BY_EXTENSION: Record<string, DocxImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

const IMAGE_MIMES = new Set<string>(["image/png", "image/jpeg", "image/gif"]);

export function isDocxImageMime(value: unknown): value is DocxImageMime {
  return typeof value === "string" && IMAGE_MIMES.has(value);
}

export function isDocxImageWrap(value: unknown): value is DocxImageWrap {
  return typeof value === "string" && (DOCX_IMAGE_WRAPS as readonly string[]).includes(value);
}

/** Pickable file → persistable mime. A missing type falls back to the
 * extension, the same rule genoffice's drop helper uses. */
export function acceptedImageMime(file: { name: string; type?: string }): DocxImageMime | null {
  if (file.type && IMAGE_MIMES.has(file.type)) return file.type as DocxImageMime;
  if (file.type) return null;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return ext ? (IMAGE_MIME_BY_EXTENSION[ext] ?? null) : null;
}

export interface DocxImageBytes {
  base64: string;
  mime: DocxImageMime;
}

/** data:image/…;base64,… → bytes the engine can embed; null for anything else. */
export function imageBytesFromDataUrl(dataUrl: string): DocxImageBytes | null {
  const match = /^data:(image\/(?:png|jpeg|gif));base64,(.+)$/s.exec(dataUrl);
  const mime = match?.[1];
  const base64 = match?.[2];
  if (!mime || !base64) return null;
  return { mime: mime as DocxImageMime, base64 };
}

export interface DocxImageInfo {
  docxIndex: number | null;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  align: DocxImageAlign | null;
  wrap: DocxImageWrap | null;
  offsetXEmu: number | null;
  offsetYEmu: number | null;
  posH: DocxImagePositionH | null;
  posV: DocxImagePositionV | null;
  rotDeg: number;
  flipH: boolean;
  flipV: boolean;
  altText: string | null;
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Read the docProtected "image" node attrs into the inspector's shape. */
export function readDocxImageInfo(attrs: Record<string, unknown> | null | undefined): DocxImageInfo | null {
  if (!attrs || attrs.blockType !== "image") return null;
  const genImage = attrs.genImage as { altText?: unknown } | null | undefined;
  const altText = typeof genImage?.altText === "string" && genImage.altText.length > 0 ? genImage.altText : null;
  return {
    docxIndex: finite(attrs.docxIndex),
    dataUrl: typeof attrs.imageDataUrl === "string" ? attrs.imageDataUrl : "",
    widthPx: finite(attrs.imageWidthPx) ?? 0,
    heightPx: finite(attrs.imageHeightPx) ?? 0,
    align: pick(attrs.imageAlign, ["left", "center", "right"] as const),
    wrap: isDocxImageWrap(attrs.imageWrap) ? attrs.imageWrap : null,
    offsetXEmu: finite(attrs.imageOffsetXEmu),
    offsetYEmu: finite(attrs.imageOffsetYEmu),
    posH: pick(attrs.imagePosH, ["left", "center", "right"] as const),
    posV: pick(attrs.imagePosV, ["top", "center", "bottom"] as const),
    rotDeg: finite(attrs.imageRotDeg) ?? 0,
    flipH: attrs.imageFlipH === true,
    flipV: attrs.imageFlipV === true,
    altText,
  };
}

/** The raw node fields the attrs patch must preserve (genImage carries the
 * pending bytes of an image that is not saved yet). */
export interface DocxImageRawContext {
  docxIndex: number | null;
  genImage: Record<string, unknown> | null;
}

export function readDocxImageRawContext(attrs: Record<string, unknown> | null | undefined): DocxImageRawContext {
  const genImage = attrs?.genImage;
  return {
    docxIndex: attrs ? (finite(attrs.docxIndex) ?? null) : null,
    genImage: genImage && typeof genImage === "object" ? (genImage as Record<string, unknown>) : null,
  };
}

export type DocxImageEdit =
  | { kind: "size"; widthPx: number; heightPx: number }
  | { kind: "align"; align: DocxImageAlign | null }
  | { kind: "wrap"; wrap: DocxImageWrap | null }
  | { kind: "position"; h: DocxImagePositionH; v: DocxImagePositionV }
  | { kind: "offset"; xEmu: number | null; yEmu: number | null }
  | { kind: "rotate"; deg: number }
  | { kind: "flip"; flipH: boolean; flipV: boolean }
  | { kind: "bytes"; base64: string; mime: DocxImageMime; widthPx: number; heightPx: number };

function withGenImage(ctx: DocxImageRawContext, patch: Record<string, unknown>): Record<string, unknown> {
  return ctx.genImage ? { genImage: { ...ctx.genImage, ...patch } } : {};
}

function withoutGenOffset(ctx: DocxImageRawContext): Record<string, unknown> {
  if (!ctx.genImage) return {};
  const rest = { ...ctx.genImage };
  delete rest.posOffsetEmu;
  return { genImage: rest };
}

/**
 * Node attrs patch for one inspector edit — the exact shape pmDocToSavePlan
 * reads back (imageWidthPx/HeightPx, imageAlign, imageWrap, imageOffsetXEmu/Y,
 * imagePosH/V, imageRotDeg, imageFlipH/V, imageReplace / genImage). Returns
 * null when the edit cannot apply (position presets are original-image only —
 * genoffice parity: newly inserted objects position after saving).
 */
export function docxImageAttrsPatch(
  ctx: DocxImageRawContext,
  edit: DocxImageEdit,
): Record<string, unknown> | null {
  switch (edit.kind) {
    case "size": {
      const widthPx = clampImagePx(edit.widthPx);
      const heightPx = clampImagePx(edit.heightPx);
      return { imageWidthPx: widthPx, imageHeightPx: heightPx, ...withGenImage(ctx, { widthPx, heightPx }) };
    }
    case "align":
      return { imageAlign: edit.align };
    case "wrap": {
      if (edit.wrap === null) {
        // back to inline: drop every anchor hint so the paragraph returns to flow
        return {
          imageWrap: null,
          imagePosH: null,
          imagePosV: null,
          imageOffsetXEmu: null,
          imageOffsetYEmu: null,
          ...withoutGenOffset(ctx),
        };
      }
      return { imageWrap: edit.wrap };
    }
    case "position": {
      if (ctx.docxIndex === null) return null;
      return {
        imageWrap: edit.h === "right" ? "square-right" : "square-left",
        imagePosH: edit.h,
        imagePosV: edit.v,
        imageOffsetXEmu: null,
        imageOffsetYEmu: null,
      };
    }
    case "offset": {
      const x = edit.xEmu === null ? null : Math.round(edit.xEmu);
      const y = edit.yEmu === null ? null : Math.round(edit.yEmu);
      if (x === null || y === null) {
        return {
          imageOffsetXEmu: null,
          imageOffsetYEmu: null,
          imagePosH: null,
          imagePosV: null,
          ...withoutGenOffset(ctx),
        };
      }
      return {
        imageOffsetXEmu: x,
        imageOffsetYEmu: y,
        imagePosH: null,
        imagePosV: null,
        ...withGenImage(ctx, { posOffsetEmu: { x, y } }),
      };
    }
    case "rotate": {
      const next = (((Math.round(edit.deg) % 360) + 360) % 360);
      return { imageRotDeg: next === 0 ? null : next };
    }
    case "flip":
      return { imageFlipH: edit.flipH, imageFlipV: edit.flipV };
    case "bytes": {
      const widthPx = clampImagePx(edit.widthPx);
      const heightPx = clampImagePx(edit.heightPx);
      const payload = {
        imageDataUrl: "data:" + edit.mime + ";base64," + edit.base64,
        imageWidthPx: widthPx,
        imageHeightPx: heightPx,
        // the new bytes are the full picture (a destructive crop); a Word-authored
        // crop/fill window must not keep clipping them (genoffice parity)
        imageCrop: null,
        imageFillRect: null,
      };
      if (ctx.docxIndex !== null) {
        return { ...payload, imageReplace: { base64: edit.base64, mime: edit.mime } };
      }
      return { ...payload, ...withGenImage(ctx, { base64: edit.base64, mime: edit.mime, widthPx, heightPx }) };
    }
  }
}

export function clampImagePx(value: number): number {
  if (!Number.isFinite(value)) return MIN_IMAGE_PX;
  return Math.min(MAX_IMAGE_PX, Math.max(MIN_IMAGE_PX, Math.round(value)));
}

export interface DocxImageSize {
  width: number;
  height: number;
}

/** Default insert size: unscaled when it fits, otherwise scaled to maxWidth. */
export function fitImageSize(natural: DocxImageSize, maxWidth: number = MAX_IMAGE_WIDTH_PX): DocxImageSize {
  const width = Math.max(MIN_IMAGE_PX, Math.round(natural.width));
  const height = Math.max(MIN_IMAGE_PX, Math.round(natural.height));
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.max(MIN_IMAGE_PX, Math.round(width * scale)), height: Math.max(MIN_IMAGE_PX, Math.round(height * scale)) };
}

/** Locked-aspect partner dimension for a committed width/height. */
export function aspectPartner(natural: DocxImageSize, changed: "width" | "height", value: number): number {
  if (natural.width <= 0 || natural.height <= 0) return clampImagePx(value);
  return changed === "width"
    ? clampImagePx((value * natural.height) / natural.width)
    : clampImagePx((value * natural.width) / natural.height);
}

export function parseImagePx(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < MIN_IMAGE_PX || parsed > MAX_IMAGE_PX) return null;
  return parsed;
}

export function pxFromEmu(emu: number | null): number | null {
  return emu === null ? null : Math.round(emu / EMU_PER_PX);
}

export function emuFromPx(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

export const DOCX_IMAGE_POSITION_PRESETS: readonly { h: DocxImagePositionH; v: DocxImagePositionV }[] = [
  { h: "left", v: "top" },
  { h: "center", v: "top" },
  { h: "right", v: "top" },
  { h: "left", v: "center" },
  { h: "center", v: "center" },
  { h: "right", v: "center" },
  { h: "left", v: "bottom" },
  { h: "center", v: "bottom" },
  { h: "right", v: "bottom" },
];

/** Wrap picker order: inline first, then the engine's nine anchor modes. */
export const DOCX_IMAGE_WRAP_OPTIONS: readonly (DocxImageWrap | null)[] = [null, ...DOCX_IMAGE_WRAPS];

// ── file reading and crop (DOM/canvas, injected measure keeps tests honest) ──

export function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function measureImageDataUrl(dataUrl: string): Promise<DocxImageSize | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(null);
    const probe = new Image();
    probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => resolve(null);
    probe.src = dataUrl;
  });
}

/** Crop region as fractions of the full image: kept area = [l,r] x [t,b]. */
export interface DocxCropRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const FULL_CROP: DocxCropRect = { l: 0, t: 0, r: 1, b: 1 };

const CROP_MIN_FRACTION = 0.05;

export function clampCrop(rect: DocxCropRect): DocxCropRect {
  const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  let l = clamp01(rect.l);
  let t = clamp01(rect.t);
  let r = clamp01(rect.r);
  let b = clamp01(rect.b);
  if (r - l < CROP_MIN_FRACTION) r = Math.min(1, l + CROP_MIN_FRACTION);
  if (b - t < CROP_MIN_FRACTION) b = Math.min(1, t + CROP_MIN_FRACTION);
  if (r - l < CROP_MIN_FRACTION) l = Math.max(0, r - CROP_MIN_FRACTION);
  if (b - t < CROP_MIN_FRACTION) t = Math.max(0, b - CROP_MIN_FRACTION);
  return { l, t, r, b };
}

export function isFullCrop(rect: DocxCropRect): boolean {
  return rect.l <= 0 && rect.t <= 0 && rect.r >= 1 && rect.b >= 1;
}

export function cropPxRect(rect: DocxCropRect, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const kept = clampCrop(rect);
  const x = Math.round(kept.l * width);
  const y = Math.round(kept.t * height);
  return {
    x,
    y,
    w: Math.max(1, Math.round((kept.r - kept.l) * width)),
    h: Math.max(1, Math.round((kept.b - kept.t) * height)),
  };
}

/** Re-encode the kept region of a data URL. Crop is destructive bytes — the
 * engine has no crop field (see DocxNewImage docs); null when the host cannot
 * give a 2D context (jsdom) or the image cannot be decoded. */
export async function cropImageDataUrl(dataUrl: string, rect: DocxCropRect, mime: DocxImageMime): Promise<string | null> {
  const size = await measureImageDataUrl(dataUrl);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  const canvas = document.createElement("canvas");
  const area = cropPxRect(rect, size.width, size.height);
  canvas.width = area.w;
  canvas.height = area.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = new Image();
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
  if (!loaded) return null;
  ctx.drawImage(image, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
  try {
    return canvas.toDataURL(mime, mime === "image/jpeg" ? 0.92 : undefined);
  } catch {
    return null;
  }
}
