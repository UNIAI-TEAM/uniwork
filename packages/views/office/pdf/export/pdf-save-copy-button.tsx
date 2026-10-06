"use client";

import { useCallback, useState } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { savePdfCopy } from "./save-copy";
import type { PdfBytesSaver, PdfOutputPort } from "./types";

export interface PdfSaveCopyButtonProps {
  /** Host output bytes. Without it the control stays disabled with a reason:
   * the browser host contract does not expose serialized bytes yet. */
  output?: PdfOutputPort;
  fileBaseName?: string;
  download?: PdfBytesSaver;
  disabled?: boolean;
  className?: string;
  onSaved?: (filename: string) => void;
}

/** Save a copy: download the host's current PDF bytes under a new name. */
export function PdfSaveCopyButton({ output, fileBaseName, download, disabled = false, className, onSaved }: PdfSaveCopyButtonProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const saveCopy = useCallback(async () => {
    if (!output) return;
    setFailed(false);
    setSaving(true);
    try {
      const filename = await savePdfCopy({ output, fileBaseName, download });
      onSaved?.(filename);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }, [download, fileBaseName, onSaved, output]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button type="button" variant="toolbar" size="sm" aria-label={t("office.pdf.export.saveCopy")} title={output ? undefined : t("office.pdf.export.saveCopyUnavailable")} aria-busy={saving || undefined} disabled={disabled || !output || saving} onClick={() => void saveCopy()}>
        <Download aria-hidden />
        {saving ? t("office.pdf.export.savingCopy") : t("office.pdf.export.saveCopy")}
      </Button>
      {failed ? <p role="alert" className="text-caption text-destructive" data-testid="pdf-save-copy-error">{t("office.pdf.export.copyFailed")}</p> : null}
    </div>
  );
}
