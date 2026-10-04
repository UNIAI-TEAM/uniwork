"use client";

// Image inspector — the controls for the selected picture. Every command goes
// through DocxImageEditing, whose patches are the exact attrs pmDocToSavePlan
// reads; nothing here writes bytes or reaches the engine directly.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  ImageUp,
  Lock,
  LockOpen,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import {
  acceptedImageMime,
  aspectPartner,
  clampImagePx,
  DOCX_IMAGE_POSITION_PRESETS,
  DOCX_IMAGE_WRAP_OPTIONS,
  emuFromPx,
  imageBytesFromDataUrl,
  MAX_IMAGE_BYTES,
  measureImageDataUrl,
  parseImagePx,
  pxFromEmu,
  readFileAsDataUrl,
  type DocxImageAlign,
  type DocxImageInfo,
  type DocxImagePositionH,
  type DocxImagePositionV,
  type DocxImageSize,
} from "./docx-image-model";
import type { DocxImageEditing } from "./docx-image-commands";
import { DocxImageCropDialog } from "./docx-image-crop-dialog";

const ALIGN_ICONS: { align: DocxImageAlign; Icon: typeof AlignLeft }[] = [
  { align: "left", Icon: AlignLeft },
  { align: "center", Icon: AlignCenter },
  { align: "right", Icon: AlignRight },
];

function positionLabelKey(v: DocxImagePositionV, h: DocxImagePositionH): string {
  const V = v === "top" ? "Top" : v === "center" ? "Center" : "Bottom";
  const H = h === "left" ? "Left" : h === "center" ? "Center" : "Right";
  return "office.docx.image.position." + V + H;
}

function sizeFromNatural(natural: DocxImageSize, currentWidth: number): { widthPx: number; heightPx: number } {
  const widthPx = clampImagePx(currentWidth > 0 ? currentWidth : natural.width);
  return { widthPx, heightPx: clampImagePx((widthPx * natural.height) / Math.max(1, natural.width)) };
}

export interface DocxImageInspectorProps {
  info: DocxImageInfo;
  editing: DocxImageEditing;
  readOnly?: boolean;
  className?: string;
  /** Test seam: natural size probe for replace/crop bytes. */
  measure?: (dataUrl: string) => Promise<DocxImageSize | null>;
}

export function DocxImageInspector({ info, editing, readOnly = false, className, measure }: DocxImageInspectorProps) {
  const { t } = useTranslation();
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const [width, setWidth] = useState(String(info.widthPx));
  const [height, setHeight] = useState(String(info.heightPx));
  const [locked, setLocked] = useState(true);
  const [offsetX, setOffsetX] = useState(info.offsetXEmu === null ? "" : String(pxFromEmu(info.offsetXEmu)));
  const [offsetY, setOffsetY] = useState(info.offsetYEmu === null ? "" : String(pxFromEmu(info.offsetYEmu)));
  const [cropOpen, setCropOpen] = useState(false);
  const [error, setError] = useState<"unsupported" | "tooLarge" | "unreadable" | null>(null);

  useEffect(() => {
    setWidth(String(info.widthPx));
    setHeight(String(info.heightPx));
    setOffsetX(info.offsetXEmu === null ? "" : String(pxFromEmu(info.offsetXEmu)));
    setOffsetY(info.offsetYEmu === null ? "" : String(pxFromEmu(info.offsetYEmu)));
  }, [info.docxIndex, info.widthPx, info.heightPx, info.offsetXEmu, info.offsetYEmu]);

  const commitSize = (next: { width?: string; height?: string }) => {
    const widthPx = parseImagePx(next.width ?? width);
    const heightPx = parseImagePx(next.height ?? height);
    if (widthPx === null || heightPx === null) {
      setWidth(String(info.widthPx));
      setHeight(String(info.heightPx));
      return;
    }
    editing.apply({ kind: "size", widthPx, heightPx });
  };

  const changeWidth = (value: string) => {
    setWidth(value);
    const parsed = parseImagePx(value);
    if (parsed !== null && locked) {
      setHeight(String(aspectPartner({ width: info.widthPx, height: info.heightPx }, "width", parsed)));
    }
  };

  const changeHeight = (value: string) => {
    setHeight(value);
    const parsed = parseImagePx(value);
    if (parsed !== null && locked) {
      setWidth(String(aspectPartner({ width: info.widthPx, height: info.heightPx }, "height", parsed)));
    }
  };

  const commitOffset = (nextX: string, nextY: string) => {
    if (nextX === "" && nextY === "") {
      editing.apply({ kind: "offset", xEmu: null, yEmu: null });
      return;
    }
    const x = Number.parseFloat(nextX);
    const y = Number.parseFloat(nextY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    editing.apply({ kind: "offset", xEmu: emuFromPx(x), yEmu: emuFromPx(y) });
  };

  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>, commit: () => void) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  const applyBytes = async (dataUrl: string, bytes: { base64: string; mime: "image/png" | "image/jpeg" | "image/gif" }) => {
    const natural = await (measure ?? measureImageDataUrl)(dataUrl);
    if (!natural || natural.width <= 0 || natural.height <= 0) {
      setError("unreadable");
      return;
    }
    const size = sizeFromNatural(natural, info.widthPx);
    editing.apply({ kind: "bytes", base64: bytes.base64, mime: bytes.mime, ...size });
    setError(null);
  };

  const replace = async (file: File | undefined) => {
    if (!file) return;
    if (replaceRef.current) replaceRef.current.value = "";
    const mime = acceptedImageMime(file);
    if (!mime) {
      setError("unsupported");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("tooLarge");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const bytes = dataUrl ? imageBytesFromDataUrl(dataUrl) : null;
    if (!dataUrl || !bytes) {
      setError("unreadable");
      return;
    }
    await applyBytes(dataUrl, bytes);
  };

  const sourceBytes = imageBytesFromDataUrl(info.dataUrl);
  const widthPx = parseImagePx(width);
  const heightPx = parseImagePx(height);

  return (
    <div
      className={cn(
        "w-full rounded-xl bg-surface-raised p-3 text-body shadow-[var(--floating-shadow)] ring-1 ring-surface-border",
        className,
      )}
      role="group"
      aria-label={t("office.docx.image.inspector")}
      data-testid="docx-image-inspector"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-title-sm font-medium">{t("office.docx.image.inspector")}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("office.docx.image.delete")}
          disabled={readOnly}
          onClick={() => editing.remove()}
          data-testid="docx-image-delete"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>

      <div className="grid gap-1.5">
        <span className="text-caption text-muted-foreground">{t("office.docx.image.size")}</span>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <Input
            aria-label={t("office.docx.image.width")}
            inputMode="numeric"
            value={width}
            disabled={readOnly}
            aria-invalid={widthPx === null}
            onChange={(event) => changeWidth(event.target.value)}
            onBlur={() => commitSize({})}
            onKeyDown={(event) => commitOnEnter(event, () => commitSize({}))}
            data-testid="docx-image-inspector-width"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-pressed={locked}
            aria-label={t("office.docx.image.lockAspect")}
            disabled={readOnly}
            onClick={() => setLocked((value) => !value)}
            data-testid="docx-image-inspector-lock"
          >
            {locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
          </Button>
          <Input
            aria-label={t("office.docx.image.height")}
            inputMode="numeric"
            value={height}
            disabled={readOnly}
            aria-invalid={heightPx === null}
            onChange={(event) => changeHeight(event.target.value)}
            onBlur={() => commitSize({})}
            onKeyDown={(event) => commitOnEnter(event, () => commitSize({}))}
            data-testid="docx-image-inspector-height"
          />
        </div>
      </div>

      <div className="mt-2 grid gap-1.5">
        <span className="text-caption text-muted-foreground">{t("office.docx.image.align.label")}</span>
        <div className="flex items-center gap-1">
          {ALIGN_ICONS.map(({ align, Icon }) => (
            <Button
              key={align}
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("office.docx.image.align." + align)}
              aria-pressed={info.align === align}
              disabled={readOnly}
              onClick={() => editing.apply({ kind: "align", align })}
              data-testid={"docx-image-align-" + align}
            >
              <Icon aria-hidden />
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-2 grid gap-1">
        <span className="text-caption text-muted-foreground">{t("office.docx.image.wrap.label")}</span>
        <Select
          aria-label={t("office.docx.image.wrap.label")}
          triggerVariant="subtle"
          disabled={readOnly}
          value={info.wrap ?? "inline"}
          items={DOCX_IMAGE_WRAP_OPTIONS.map((wrap) => ({
            value: wrap ?? "inline",
            label: t("office.docx.image.wrap." + (wrap ?? "inline")),
          }))}
          onValueChange={(value) =>
            editing.apply({ kind: "wrap", wrap: value === "inline" ? null : (value as DocxImageInfo["wrap"]) })
          }
        />
      </div>

      {info.docxIndex !== null ? (
        <div className="mt-2 grid gap-1.5">
          <span className="text-caption text-muted-foreground">{t("office.docx.image.position.label")}</span>
          <div className="grid w-fit grid-cols-3 gap-1">
            {DOCX_IMAGE_POSITION_PRESETS.map((preset) => (
              <Button
                key={preset.v + preset.h}
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={t(positionLabelKey(preset.v, preset.h))}
                aria-pressed={info.posH === preset.h && info.posV === preset.v}
                disabled={readOnly}
                onClick={() => editing.apply({ kind: "position", h: preset.h, v: preset.v })}
                data-testid={"docx-image-position-" + preset.v + "-" + preset.h}
              >
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-caption text-muted-foreground">{t("office.docx.image.positionAfterSave")}</p>
      )}

      {info.wrap !== null ? (
        <div className="mt-2 grid gap-1.5">
          <span className="text-caption text-muted-foreground">{t("office.docx.image.offset.label")}</span>
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label={t("office.docx.image.offset.x")}
              inputMode="numeric"
              placeholder="0"
              value={offsetX}
              disabled={readOnly}
              onChange={(event) => setOffsetX(event.target.value)}
              onBlur={() => commitOffset(offsetX, offsetY)}
              onKeyDown={(event) => commitOnEnter(event, () => commitOffset(offsetX, offsetY))}
              data-testid="docx-image-offset-x"
            />
            <Input
              aria-label={t("office.docx.image.offset.y")}
              inputMode="numeric"
              placeholder="0"
              value={offsetY}
              disabled={readOnly}
              onChange={(event) => setOffsetY(event.target.value)}
              onBlur={() => commitOffset(offsetX, offsetY)}
              onKeyDown={(event) => commitOnEnter(event, () => commitOffset(offsetX, offsetY))}
              data-testid="docx-image-offset-y"
            />
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("office.docx.image.rotate.left")}
          disabled={readOnly}
          onClick={() => editing.apply({ kind: "rotate", deg: info.rotDeg - 90 })}
          data-testid="docx-image-rotate-left"
        >
          <RotateCcw aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("office.docx.image.rotate.right")}
          disabled={readOnly}
          onClick={() => editing.apply({ kind: "rotate", deg: info.rotDeg + 90 })}
          data-testid="docx-image-rotate-right"
        >
          <RotateCw aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("office.docx.image.flip.h")}
          aria-pressed={info.flipH}
          disabled={readOnly}
          onClick={() => editing.apply({ kind: "flip", flipH: !info.flipH, flipV: info.flipV })}
          data-testid="docx-image-flip-h"
        >
          <FlipHorizontal2 aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("office.docx.image.flip.v")}
          aria-pressed={info.flipV}
          disabled={readOnly}
          onClick={() => editing.apply({ kind: "flip", flipH: info.flipH, flipV: !info.flipV })}
          data-testid="docx-image-flip-v"
        >
          <FlipVertical2 aria-hidden />
        </Button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly}
          onClick={() => replaceRef.current?.click()}
          data-testid="docx-image-replace"
        >
          <ImageUp aria-hidden />
          {t("office.docx.image.replace")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly || !sourceBytes}
          onClick={() => setCropOpen(true)}
          data-testid="docx-image-crop"
        >
          <Crop aria-hidden />
          {t("office.docx.image.crop.command")}
        </Button>
      </div>

      <input
        ref={replaceRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="sr-only"
        disabled={readOnly}
        onChange={(event) => void replace(event.target.files?.[0])}
        data-testid="docx-image-replace-input"
      />
      {error ? (
        <p className="mt-1 text-caption text-destructive" role="alert" data-testid="docx-image-inspector-error">
          {t("office.docx.image.errors." + error)}
        </p>
      ) : null}

      {sourceBytes ? (
        <DocxImageCropDialog
          open={cropOpen}
          dataUrl={info.dataUrl}
          mime={sourceBytes.mime}
          disabled={readOnly}
          onOpenChange={setCropOpen}
          onApply={(cropped) => {
            const bytes = imageBytesFromDataUrl(cropped);
            setCropOpen(false);
            if (bytes) void applyBytes(cropped, bytes);
          }}
        />
      ) : null}
    </div>
  );
}
