"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { PdfImageOperationProvider, PdfImageRect } from "./types";
import { pdfImageErrorMessage } from "./error";
import { MAX_PDF_IMAGE_BYTES } from "./provider";

const DEFAULT_RECT: PdfImageRect = [36, 36, 216, 156];

export function readImageFile(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then((value) => new Uint8Array(value));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("image file could not be read"));
    reader.readAsArrayBuffer(file);
  });
}

type ImageLayer = "belowText" | "aboveText";

export interface PdfImageInsertPanelProps {
  page: number;
  provider: PdfImageOperationProvider;
  disabled?: boolean;
  rect?: PdfImageRect;
  onApplied?: () => void;
}

/** File-backed image insertion. Bytes are handed to the browser-safe provider;
 * decoding and PDF mutation remain in the host U-4 codec. */
export function PdfImageInsertPanel({ page, provider, disabled = false, rect = DEFAULT_RECT, onApplied }: PdfImageInsertPanelProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [layer, setLayer] = useState<ImageLayer>("aboveText");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = t("office.pdf.image.insert");

  const submit = async () => {
    if (!file || !file.type.match(/^image\/(png|jpeg)$/)) {
      setError(t("office.pdf.image.errors.fileType"));
      return;
    }
    if (file.size > MAX_PDF_IMAGE_BYTES) {
      setError(t("office.pdf.image.errors.asset"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const bytes = await readImageFile(file);
      await provider.insertImage({ pageIndex: page - 1, rect, image: bytes, layer });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onApplied?.();
    } catch (reason) {
      setError(pdfImageErrorMessage(reason, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-3 grid gap-2" data-testid="pdf-image-insert-panel">
      <label className="sr-only" htmlFor="pdf-image-insert-file">{title}</label>
      <input id="pdf-image-insert-file" type="file" accept="image/png,image/jpeg" className="sr-only" ref={inputRef} onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={disabled || pending} />
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={disabled || pending}>{title}</Button>
      {file ? <p className="min-w-0 truncate text-caption text-muted-foreground">{file.name}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("office.pdf.image.layer")} className="flex flex-wrap items-center gap-2">
          <Button type="button" variant={layer === "aboveText" ? "secondary" : "outline"} aria-pressed={layer === "aboveText"} onClick={() => setLayer("aboveText")} disabled={disabled || pending}>{t("office.pdf.image.layerAbove")}</Button>
          <Button type="button" variant={layer === "belowText" ? "secondary" : "outline"} aria-pressed={layer === "belowText"} onClick={() => setLayer("belowText")} disabled={disabled || pending}>{t("office.pdf.image.layerBelow")}</Button>
        </div>
        <Button type="button" variant="outline" onClick={() => void submit()} disabled={disabled || pending || !file}>{title}</Button>
      </div>
      {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}
    </section>
  );
}
