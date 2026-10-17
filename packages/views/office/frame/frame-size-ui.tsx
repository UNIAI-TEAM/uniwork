"use client";

import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import type { DocsFrameSaveBlocked, DocsFrameSizeWarning } from "./docs-frame-session-model";

export function FrameSizeWarningChip({ warning }: { warning: DocsFrameSizeWarning | null }) {
  const { t, i18n } = useTranslation();
  if (!warning) return null;
  const max = formatDocumentSizeMB(warning.maxBytes, i18n.language);
  const size = formatDocumentSizeMB(warning.bytes, i18n.language, warning.maxBytes);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="office-size-warning-chip"
      className="flex shrink-0 items-center justify-end border-b bg-muted/40 px-3 py-1 text-caption text-muted-foreground"
    >
      {t("office.size.warn_chip", { max, size })}
    </div>
  );
}

export interface FrameSaveBlockedDialogProps {
  saveBlocked: DocsFrameSaveBlocked | null;
  onDownload: () => void;
  onDismiss: () => void;
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
}

export function FrameSaveBlockedDialog({
  saveBlocked,
  onDownload,
  onDismiss,
  finalFocus,
}: FrameSaveBlockedDialogProps) {
  const { t, i18n } = useTranslation();
  const max = saveBlocked ? formatDocumentSizeMB(saveBlocked.maxBytes, i18n.language) : "";
  return (
    <Dialog open={saveBlocked !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        aria-describedby="office-save-blocked-description"
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("office.size.save_blocked.title")}</DialogTitle>
          <DialogDescription id="office-save-blocked-description">
            {saveBlocked ? t("office.size.save_blocked.body", { max }) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDismiss}>
            {t("office.size.save_blocked.close")}
          </Button>
          <Button type="button" onClick={onDownload}>
            {t("office.size.save_blocked.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
