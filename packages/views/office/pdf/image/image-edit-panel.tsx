"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { pdfImageErrorMessage } from "./error";
import { readImageFile } from "./image-insert-panel";
import type { PdfImageOperationProvider, PdfImageRect, PdfImageSelection } from "./types";

export interface PdfImageEditPanelProps {
  selection: PdfImageSelection | null;
  provider: PdfImageOperationProvider;
  disabled?: boolean;
  onApplied?: () => void;
}

function copy(t: ReturnType<typeof useTranslation>["t"], key: string, fallback: string): string {
  return t(key, { defaultValue: fallback });
}

function number(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Image-object controls for move/resize/rotate, replacement and deletion. */
export function PdfImageEditPanel({ selection, provider, disabled = false, onApplied }: PdfImageEditPanelProps) {
  const { t } = useTranslation();
  const [rect, setRect] = useState<PdfImageRect>(selection?.rect ?? [0, 0, 1, 1]);
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
    setRect([selectedX1 ?? 0, selectedY1 ?? 0, selectedX2 ?? 1, selectedY2 ?? 1]);
    setQuarterTurns("0");
    setFile(null);
    setError(null);
  }, [selectedObjectId, selectedPage, selectedX1, selectedY1, selectedX2, selectedY2]);

  if (!selection) return null;
  const applyLabel = copy(t, "office.pdf.image.apply", "Apply image changes");
  const deleteLabel = copy(t, "office.pdf.image.delete", "Delete image");
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
  const transform = () => void run(() => provider.transformImage({ pageIndex: selection.page - 1, oldRect: selection.rect, rect, ...(selection.layer ? { layer: selection.layer } : {}), quarterTurns: number(quarterTurns, 0) }));
  const replace = () => {
    if (!file || !file.type.match(/^image\/(png|jpeg)$/)) {
      setError(copy(t, "office.pdf.image.errors.fileType", t("office.pdf.errors.editFailed")));
      return;
    }
    void run(async () => provider.replaceImage({ target: { page: selection.page, objectId: selection.objectId }, image: await readImageFile(file), rect }));
  };
  const remove = () => void run(() => provider.deleteImage({ pageIndex: selection.page - 1, oldRect: selection.rect }));

  return (
    <section className="mt-3 grid gap-2" data-testid="pdf-image-edit-panel">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["Left", "Top", "Right", "Bottom"] as const).map((label, index) => (
          <label key={label} className="grid gap-1 text-caption" htmlFor={`pdf-image-${label.toLowerCase()}`}>
            {copy(t, `office.pdf.image.${label.toLowerCase()}`, label)}
            <Input id={`pdf-image-${label.toLowerCase()}`} type="number" value={rect[index]} disabled={disabled || pending} onChange={(event) => setRect((current) => current.map((value, position) => position === index ? number(event.target.value, value) : value) as PdfImageRect)} />
          </label>
        ))}
      </div>
      <label className="grid gap-1 text-caption" htmlFor="pdf-image-rotation">
        {copy(t, "office.pdf.image.rotation", "Rotation")}
        <Input id="pdf-image-rotation" type="number" step={1} value={quarterTurns} disabled={disabled || pending} onChange={(event) => setQuarterTurns(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={transform} disabled={disabled || pending}>{applyLabel}</Button>
        <Button type="button" variant="outline" onClick={remove} disabled={disabled || pending}>{deleteLabel}</Button>
      </div>
      <label className="sr-only" htmlFor="pdf-image-replace-file">{copy(t, "office.pdf.image.replaceFile", "Replace image file")}</label>
      <Input id="pdf-image-replace-file" type="file" accept="image/png,image/jpeg" disabled={disabled || pending} onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-label={copy(t, "office.pdf.image.replaceFile", "Replace image file")} />
      <Button type="button" variant="outline" onClick={replace} disabled={disabled || pending || !file}>{replaceLabel}</Button>
      {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}
    </section>
  );
}
