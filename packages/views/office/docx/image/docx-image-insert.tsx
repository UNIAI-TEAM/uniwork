"use client";

// Insert-from-file entry for the DOCX image layer: picker, mime/size
// validation, preview with alt text and a default size that preserves the
// aspect ratio. The actual node insertion goes through DocxImageEditing.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Lock, LockOpen } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  acceptedImageMime,
  aspectPartner,
  fitImageSize,
  imageBytesFromDataUrl,
  MAX_IMAGE_BYTES,
  measureImageDataUrl,
  parseImagePx,
  readFileAsDataUrl,
  type DocxImageBytes,
  type DocxImageSize,
} from "./docx-image-model";
import type { DocxImageEditing } from "./docx-image-commands";

export interface DocxImageInsertProps {
  editing: DocxImageEditing;
  readOnly?: boolean;
  className?: string;
  /** Test seam: natural size probe for a picked data URL. */
  measure?: (dataUrl: string) => Promise<DocxImageSize | null>;
}

interface PickCandidate {
  dataUrl: string;
  bytes: DocxImageBytes;
  name: string;
  natural: DocxImageSize;
}

type PickError = "unsupported" | "tooLarge" | "unreadable";

function defaultAltText(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function DocxImageInsert({ editing, readOnly = false, className, measure }: DocxImageInsertProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [candidate, setCandidate] = useState<PickCandidate | null>(null);
  const [error, setError] = useState<PickError | null>(null);
  const [altText, setAltText] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [locked, setLocked] = useState(true);

  const closeDialog = () => {
    setCandidate(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
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
    if (!dataUrl) {
      setError("unreadable");
      return;
    }
    const bytes = imageBytesFromDataUrl(dataUrl);
    const natural = await (measure ?? measureImageDataUrl)(dataUrl);
    if (!bytes || !natural || natural.width <= 0 || natural.height <= 0) {
      setError("unreadable");
      return;
    }
    const size = fitImageSize(natural);
    setCandidate({ dataUrl, bytes, name: file.name, natural });
    setAltText(defaultAltText(file.name));
    setWidth(String(size.width));
    setHeight(String(size.height));
    setLocked(true);
    setError(null);
  };

  const commit = () => {
    if (!candidate) return;
    const widthPx = parseImagePx(width);
    const heightPx = parseImagePx(height);
    if (widthPx === null || heightPx === null) return;
    const inserted = editing.insert({
      base64: candidate.bytes.base64,
      mime: candidate.bytes.mime,
      widthPx,
      heightPx,
      ...(altText.trim() ? { altText: altText.trim() } : {}),
      label: candidate.name,
    });
    if (inserted) closeDialog();
  };

  const changeWidth = (value: string) => {
    setWidth(value);
    const parsed = parseImagePx(value);
    if (parsed !== null && candidate && locked) setHeight(String(aspectPartner(candidate.natural, "width", parsed)));
  };

  const changeHeight = (value: string) => {
    setHeight(value);
    const parsed = parseImagePx(value);
    if (parsed !== null && candidate && locked) setWidth(String(aspectPartner(candidate.natural, "height", parsed)));
  };

  const widthPx = parseImagePx(width);
  const heightPx = parseImagePx(height);

  return (
    <div className={className}>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        className="gap-1.5 shadow-sm"
        aria-label={t("office.docx.image.insert")}
        disabled={readOnly}
        onClick={() => inputRef.current?.click()}
        data-testid="docx-image-insert-button"
      >
        <ImagePlus aria-hidden />
        <span className="hidden sm:inline">{t("office.docx.image.insert")}</span>
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="sr-only"
        disabled={readOnly}
        onChange={(event) => void pick(event.target.files?.[0])}
        data-testid="docx-image-file-input"
      />
      {error ? (
        <p className="mt-1 rounded-md bg-surface-raised px-2 py-1 text-caption text-destructive shadow-sm" role="alert" data-testid="docx-image-error">
          {t("office.docx.image.errors." + error)}
        </p>
      ) : null}
      <Dialog open={candidate !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent closeLabel={t("office.docx.image.close")} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("office.docx.image.insertTitle")}</DialogTitle>
            <DialogDescription>{t("office.docx.image.insertHint")}</DialogDescription>
          </DialogHeader>
          {candidate ? (
            <img src={candidate.dataUrl} alt="" className="mx-auto max-h-48 max-w-full rounded-md" data-testid="docx-image-preview" />
          ) : null}
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="docx-image-alt">{t("office.docx.image.altText")}</Label>
              <Input
                id="docx-image-alt"
                value={altText}
                placeholder={t("office.docx.image.altTextPlaceholder")}
                onChange={(event) => setAltText(event.target.value)}
                data-testid="docx-image-alt-input"
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor="docx-image-width">{t("office.docx.image.width")}</Label>
                <Input
                  id="docx-image-width"
                  inputMode="numeric"
                  value={width}
                  aria-invalid={widthPx === null}
                  onChange={(event) => changeWidth(event.target.value)}
                  data-testid="docx-image-width-input"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-pressed={locked}
                aria-label={t("office.docx.image.lockAspect")}
                onClick={() => setLocked((value) => !value)}
                data-testid="docx-image-lock-aspect"
              >
                {locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
              </Button>
              <div className="grid gap-1">
                <Label htmlFor="docx-image-height">{t("office.docx.image.height")}</Label>
                <Input
                  id="docx-image-height"
                  inputMode="numeric"
                  value={height}
                  aria-invalid={heightPx === null}
                  onChange={(event) => changeHeight(event.target.value)}
                  data-testid="docx-image-height-input"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              {t("office.docx.image.cancel")}
            </Button>
            <Button
              type="button"
              onClick={commit}
              disabled={readOnly || widthPx === null || heightPx === null}
              data-testid="docx-image-insert-confirm"
            >
              {t("office.docx.image.insert")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
