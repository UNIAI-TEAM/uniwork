"use client";

// Crop dialog — the engine has no crop field (NewImage docs), so applying a
// crop re-encodes the kept region to new bytes which the model then routes to
// imageReplace (original picture) or genImage (unsaved picture).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { clampCrop, cropImageDataUrl, isFullCrop, FULL_CROP, type DocxCropRect, type DocxImageMime } from "./docx-image-model";

type CropHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "move";

const CORNER_HANDLES: { handle: CropHandle; className: string }[] = [
  { handle: "nw", className: "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize" },
  { handle: "ne", className: "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize" },
  { handle: "sw", className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize" },
  { handle: "se", className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize" },
];

const EDGE_HANDLES: { handle: CropHandle; className: string }[] = [
  { handle: "n", className: "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize" },
  { handle: "s", className: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize" },
  { handle: "w", className: "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize" },
  { handle: "e", className: "top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize" },
];

function dragRect(start: DocxCropRect, handle: CropHandle, dx: number, dy: number): DocxCropRect {
  if (handle === "move") {
    const width = start.r - start.l;
    const height = start.b - start.t;
    const l = Math.min(Math.max(0, start.l + dx), 1 - width);
    const t = Math.min(Math.max(0, start.t + dy), 1 - height);
    return { l, t, r: l + width, b: t + height };
  }
  const next = { ...start };
  if (handle.includes("w")) next.l = start.l + dx;
  if (handle.includes("e")) next.r = start.r + dx;
  if (handle.includes("n")) next.t = start.t + dy;
  if (handle.includes("s")) next.b = start.b + dy;
  return next;
}

export interface DocxImageCropDialogProps {
  open: boolean;
  dataUrl: string;
  mime: DocxImageMime;
  disabled?: boolean;
  onOpenChange(open: boolean): void;
  onApply(croppedDataUrl: string): void;
}

export function DocxImageCropDialog({ open, dataUrl, mime, disabled = false, onOpenChange, onApply }: DocxImageCropDialogProps) {
  const { t } = useTranslation();
  const [rect, setRect] = useState<DocxCropRect>(FULL_CROP);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setRect(FULL_CROP);
      setFailed(false);
      setWorking(false);
    }
  }, [open, dataUrl]);

  const beginDrag = (handle: CropHandle) => (event: ReactPointerEvent<HTMLElement>) => {
    const frame = frameRef.current;
    if (!frame || disabled) return;
    const box = frame.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = rect;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / box.width;
      const dy = (moveEvent.clientY - startY) / box.height;
      setRect(clampCrop(dragRect(start, handle, dx, dy)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const apply = async () => {
    setWorking(true);
    const cropped = await cropImageDataUrl(dataUrl, rect, mime);
    setWorking(false);
    if (!cropped) {
      setFailed(true);
      return;
    }
    onApply(cropped);
  };

  const kept = {
    left: rect.l * 100 + "%",
    top: rect.t * 100 + "%",
    width: (rect.r - rect.l) * 100 + "%",
    height: (rect.b - rect.t) * 100 + "%",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("office.docx.image.close")} className="sm:max-w-lg" data-testid="docx-image-crop-dialog">
        <DialogHeader>
          <DialogTitle>{t("office.docx.image.crop.title")}</DialogTitle>
          <DialogDescription>{t("office.docx.image.crop.hint")}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-2">
          <div ref={frameRef} className="relative inline-block max-w-full select-none" data-testid="docx-image-crop-frame">
            <img src={dataUrl} alt="" draggable={false} className="block max-h-72 max-w-full" data-testid="docx-image-crop-image" />
            <div
              className="absolute cursor-move ring-2 ring-primary"
              style={kept}
              onPointerDown={beginDrag("move")}
              data-testid="docx-image-crop-kept"
            >
              {[...CORNER_HANDLES, ...EDGE_HANDLES].map(({ handle, className }) => (
                <button
                  key={handle}
                  type="button"
                  aria-label={t("office.docx.image.crop.handle", { handle })}
                  className={"absolute size-2.5 rounded-full bg-primary ring-1 ring-background " + className}
                  onPointerDown={beginDrag(handle)}
                  data-testid={"docx-image-crop-handle-" + handle}
                />
              ))}
            </div>
          </div>
        </div>
        {failed ? <p className="text-caption text-destructive" role="alert">{t("office.docx.image.crop.failed")}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setRect(FULL_CROP)} disabled={disabled || isFullCrop(rect)}>
            <RotateCcw aria-hidden />
            {t("office.docx.image.crop.reset")}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("office.docx.image.cancel")}
          </Button>
          <Button type="button" onClick={() => void apply()} disabled={disabled || working || isFullCrop(rect)} data-testid="docx-image-crop-apply">
            {t("office.docx.image.crop.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
