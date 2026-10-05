"use client";

import { useCallback, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { createBrowserPdfPrintPort } from "./browser-print";
import type { PdfPrintPort } from "./types";

export interface PdfPrintButtonProps {
  /** The document surface to print; the markup is scoped to it. */
  surfaceRef: { readonly current: HTMLElement | null };
  /** Host print implementation; defaults to the browser print dialog. */
  port?: PdfPrintPort;
  disabled?: boolean;
  className?: string;
  onPrinted?: () => void;
}

export function PdfPrintButton({ surfaceRef, port, disabled = false, className, onPrinted }: PdfPrintButtonProps) {
  const { t } = useTranslation();
  const [printing, setPrinting] = useState(false);
  const [failed, setFailed] = useState(false);
  const printPort = useMemo(() => port ?? createBrowserPdfPrintPort(), [port]);

  const print = useCallback(async () => {
    const surface = surfaceRef.current;
    if (!surface) {
      setFailed(true);
      return;
    }
    setPrinting(true);
    setFailed(false);
    try {
      await printPort.printSurface(surface);
      onPrinted?.();
    } catch {
      setFailed(true);
    } finally {
      setPrinting(false);
    }
  }, [onPrinted, printPort, surfaceRef]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button type="button" variant="toolbar" size="sm" aria-label={t("office.pdf.print.action")} aria-busy={printing || undefined} disabled={disabled || printing} onClick={() => void print()}>
        <Printer aria-hidden />
        {printing ? t("office.pdf.print.preparing") : t("office.pdf.print.action")}
      </Button>
      {failed ? <p role="alert" className="text-caption text-destructive" data-testid="pdf-print-error">{t("office.pdf.print.failed")}</p> : null}
    </div>
  );
}
