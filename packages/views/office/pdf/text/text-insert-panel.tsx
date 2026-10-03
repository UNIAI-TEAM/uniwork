"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import type { PdfTextOperationProvider } from "./types";
import { pdfTextErrorMessage } from "./error";

export interface PdfTextInsertPanelProps {
  page: number;
  provider: PdfTextOperationProvider;
  disabled?: boolean;
  origin?: [number, number];
  onApplied?: () => void;
}

/** Adds a searchable text object at a host-provided PDF user-space origin. */
export function PdfTextInsertPanel({ page, provider, disabled = false, origin = [36, 36], onApplied }: PdfTextInsertPanelProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState("12");
  const [font, setFont] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim()) return;
    const size = Number(fontSize);
    if (!Number.isFinite(size) || size <= 0) return;
    setPending(true);
    setError(null);
    try {
      await provider.addTextInsert({ pageIndex: page - 1, origin, text, fontSize: size, color: [0, 0, 0], ...(font.trim() ? { font: font.trim() } : {}) });
      setText("");
      onApplied?.();
    } catch (reason) {
      setError(pdfTextErrorMessage(reason, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-3 grid gap-2" data-testid="pdf-text-insert-panel" aria-label={t("office.pdf.commands.editText")}>
      <label className="sr-only" htmlFor="pdf-text-insert-input">{t("office.pdf.edit.textLabel")}</label>
      <Input id="pdf-text-insert-input" value={text} onChange={(event) => setText(event.target.value)} placeholder={t("office.pdf.edit.textPlaceholder")} disabled={disabled || pending} />
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="pdf-text-insert-font">{t("office.pdf.edit.textLabel")}</label>
        <Input id="pdf-text-insert-font" value={font} onChange={(event) => setFont(event.target.value)} placeholder={t("office.pdf.edit.textLabel")} disabled={disabled || pending} />
        <label className="sr-only" htmlFor="pdf-text-insert-size">{t("office.pdf.statusBar.zoom")}</label>
        <Input id="pdf-text-insert-size" inputMode="decimal" type="number" min={1} step={1} value={fontSize} onChange={(event) => setFontSize(event.target.value)} disabled={disabled || pending} />
        <Button type="button" variant="outline" onClick={() => void submit()} disabled={disabled || pending || !text.trim()}>{t("office.pdf.edit.applyText")}</Button>
      </div>
      {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}
    </section>
  );
}
