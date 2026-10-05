"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import type { PdfTextOperationProvider, PdfTextSelection } from "./types";
import { pdfTextErrorMessage } from "./error";

export interface PdfTextEditPanelProps {
  selection: PdfTextSelection | null;
  provider: PdfTextOperationProvider;
  disabled?: boolean;
  onApplied?: () => void;
}

/** In-place editing for one selected text run. Geometry and old text come from
 * the host selection provider; this component only collects the replacement. */
export function PdfTextEditPanel({ selection, provider, disabled = false, onApplied }: PdfTextEditPanelProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [font, setFont] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setText(selection?.text ?? "");
    setFont("");
    setFontSize(selection ? String(selection.fontSize) : "");
    setError(null);
    setNotice(null);
  }, [selection]);

  if (!selection) return null;

  const parsedSize = Number(fontSize);
  const sizeInvalid = fontSize.trim() !== "" && (!Number.isFinite(parsedSize) || parsedSize <= 0);
  const nextFont = font.trim();
  const sizeChanges = Number.isFinite(parsedSize) && parsedSize > 0 && parsedSize !== selection.fontSize;
  const unchanged = text === selection.text && nextFont === "" && !sizeChanges;

  const submit = async () => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await provider.putTextEdit({
        objectId: selection.objectId,
        pageIndex: selection.page - 1,
        rect: selection.rect,
        oldText: selection.text,
        newText: text,
        fontSize: selection.fontSize,
        ...(nextFont ? { newFont: nextFont } : {}),
        ...(sizeChanges ? { newFontSize: parsedSize } : {}),
      });
      if (outcome?.warnings?.some((warning) => warning.code === "edit_skipped")) {
        setNotice(t("office.pdf.edit.skipped"));
        return;
      }
      onApplied?.();
    } catch (reason) {
      setError(pdfTextErrorMessage(reason, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-3 grid gap-2" data-testid="pdf-text-edit-panel" aria-label={t("office.pdf.commands.editText")}>
      <label className="sr-only" htmlFor="pdf-text-edit-input">{t("office.pdf.edit.textLabel")}</label>
      <Input id="pdf-text-edit-input" value={text} onChange={(event) => setText(event.target.value)} placeholder={t("office.pdf.edit.textPlaceholder")} disabled={disabled || pending} />
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="pdf-text-edit-font">{t("office.pdf.edit.fontLabel")}</label>
        <Input id="pdf-text-edit-font" value={font} onChange={(event) => setFont(event.target.value)} placeholder={t("office.pdf.edit.fontPlaceholder")} disabled={disabled || pending} />
        <label className="sr-only" htmlFor="pdf-text-edit-size">{t("office.pdf.edit.fontSizeLabel")}</label>
        <Input id="pdf-text-edit-size" inputMode="decimal" type="number" min={1} step={1} aria-invalid={sizeInvalid} value={fontSize} onChange={(event) => setFontSize(event.target.value)} disabled={disabled || pending} />
        <Button type="button" variant="outline" onClick={() => void submit()} disabled={disabled || pending || sizeInvalid || unchanged}>{t("office.pdf.edit.applyText")}</Button>
      </div>
      {notice ? <p role="status" className="text-caption text-muted-foreground">{notice}</p> : null}
      {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}
    </section>
  );
}
