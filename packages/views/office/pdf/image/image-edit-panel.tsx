"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { pdfImageErrorMessage } from "./error";
import { readImageFile } from "./image-insert-panel";
import { MAX_PDF_IMAGE_BYTES } from "./provider";
import type { PdfImageOperationProvider, PdfImageRect, PdfImageSelection } from "./types";

export interface PdfImageEditPanelProps {
  selection: PdfImageSelection | null;
  provider: PdfImageOperationProvider;
  disabled?: boolean;
  onApplied?: () => void;
}

type RectFields = [string, string, string, string];

/** `Number("")` is 0, so emptiness is answered before the parse: a cleared
 * coordinate stays invalid instead of silently zeroing the field. */
function parseNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function rectFields(selection: PdfImageSelection | null): RectFields {
  return selection
    ? [String(selection.rect[0]), String(selection.rect[1]), String(selection.rect[2]), String(selection.rect[3])]
    : ["0", "0", "1", "1"];
}

/** Image-object controls for move/resize/rotate, replacement and deletion. */
export function PdfImageEditPanel({ selection, provider, disabled = false, onApplied }: PdfImageEditPanelProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState<RectFields>(() => rectFields(selection));
  const [quarterTurns, setQuarterTurns] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedObjectId = selection?.objectId;
  const selectedPage = selection?.page;
  const selectedX1 = selection?.rect[0];
  const selectedY1 = selection?.rect[1];
  const selectedX2 = selection?.rect[2];
  const selectedY2 = selection?.rect[3];

  useEffect(() => {
    setFields([String(selectedX1 ?? 0), String(selectedY1 ?? 0), String(selectedX2 ?? 1), String(selectedY2 ?? 1)]);
    setQuarterTurns("0");
    setFile(null);
    setError(null);
  }, [selectedObjectId, selectedPage, selectedX1, selectedY1, selectedX2, selectedY2]);

  if (!selection) return null;

  const values: PdfImageRect = [parseNumber(fields[0]), parseNumber(fields[1]), parseNumber(fields[2]), parseNumber(fields[3])];
  const fieldInvalid = (index: number): boolean => {
    const value = values[index]!;
    if (!Number.isFinite(value)) return true;
    if (index === 2) return Number.isFinite(values[0]) && value <= values[0]!;
    if (index === 3) return Number.isFinite(values[1]) && value <= values[1]!;
    return false;
  };
  const rectInvalid = fieldInvalid(0) || fieldInvalid(1) || fieldInvalid(2) || fieldInvalid(3);
  const turns = parseNumber(quarterTurns);
  const turnsInvalid = !Number.isSafeInteger(turns);

  const applyLabel = t("office.pdf.image.apply");
  const deleteLabel = t("office.pdf.image.delete");
  const replaceFileLabel = t("office.pdf.image.replaceFile");
  const replaceLabel = t("office.pdf.commands.replaceImage");
  const run = async (action: () => Promise<void> | void) => {
    setPending(true);
    setError(null);
    try {
      await action();
      onApplied?.();
    } catch (reason) {
      setError(pdfImageErrorMessage(reason, t));
    } finally {
      setPending(false);
    }
  };
  const transform = () => {
    if (rectInvalid || turnsInvalid) return;
    void run(() => provider.transformImage({ pageIndex: selection.page - 1, oldRect: selection.rect, rect: values, ...(selection.layer ? { layer: selection.layer } : {}), quarterTurns: turns }));
  };
  const replace = () => {
    if (!file || !file.type.match(/^image\/(png|jpeg)$/)) {
      setError(t("office.pdf.image.errors.fileType"));
      return;
    }
    if (file.size > MAX_PDF_IMAGE_BYTES) {
      setError(t("office.pdf.image.errors.asset"));
      return;
    }
    if (rectInvalid) return;
    void run(async () => provider.replaceImage({ target: { page: selection.page, objectId: selection.objectId }, image: await readImageFile(file), rect: values }));
  };
  const remove = () => void run(() => provider.deleteImage({ pageIndex: selection.page - 1, oldRect: selection.rect }));

  return (
    <section className="mt-3 grid gap-2" data-testid="pdf-image-edit-panel">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["Left", "Top", "Right", "Bottom"] as const).map((label, index) => (
          <label key={label} className="grid gap-1 text-caption" htmlFor={`pdf-image-${label.toLowerCase()}`}>
            {t(`office.pdf.image.${label.toLowerCase()}`)}
            <Input
              id={`pdf-image-${label.toLowerCase()}`}
              type="number"
              value={fields[index]}
              aria-invalid={fieldInvalid(index)}
              disabled={disabled || pending}
              onChange={(event) =>
                setFields((current) => {
                  const next = [...current] as RectFields;
                  next[index] = event.target.value;
                  return next;
                })
              }
            />
          </label>
        ))}
      </div>
      <label className="grid gap-1 text-caption" htmlFor="pdf-image-rotation">
        {t("office.pdf.image.rotation")}
        <Input id="pdf-image-rotation" type="number" step={1} value={quarterTurns} aria-invalid={turnsInvalid} disabled={disabled || pending} onChange={(event) => setQuarterTurns(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={transform} disabled={disabled || pending || rectInvalid || turnsInvalid}>{applyLabel}</Button>
        <Button type="button" variant="outline" onClick={remove} disabled={disabled || pending}>{deleteLabel}</Button>
      </div>
      <label className="sr-only" htmlFor="pdf-image-replace-file">{replaceFileLabel}</label>
      <input id="pdf-image-replace-file" type="file" accept="image/png,image/jpeg" className="sr-only" ref={fileRef} disabled={disabled || pending} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={disabled || pending}>{replaceFileLabel}</Button>
      <Button type="button" variant="outline" onClick={replace} disabled={disabled || pending || !file || rectInvalid}>{replaceLabel}</Button>
      {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}
    </section>
  );
}
