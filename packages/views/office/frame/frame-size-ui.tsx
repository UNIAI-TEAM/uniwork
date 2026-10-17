"use client";

import { useRef, useState, type ComponentProps } from "react";
import { TriangleAlert } from "lucide-react";
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
import { Notice } from "../../common/notice";
import type { DocsFrameSaveBlocked, DocsFrameSizeWarning } from "./docs-frame-session-model";

export function FrameSizeWarningChip({ warning }: { warning: DocsFrameSizeWarning | null }) {
  const { t, i18n } = useTranslation();
  if (!warning) return null;
  const max = formatDocumentSizeMB(warning.maxBytes, i18n.language);
  const size = formatDocumentSizeMB(warning.bytes, i18n.language, warning.maxBytes);
  return (
    // The same amber strip as the lag banner: the live region is Notice's own (role=status, polite).
    <div data-testid="office-size-warning-chip" className="shrink-0">
      <Notice tone="warning" icon={TriangleAlert}>
        {t("office.size.warn_chip", { max, size })}
      </Notice>
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
  const downloadRef = useRef<HTMLButtonElement | null>(null);
  const [lastBlocked, setLastBlocked] = useState<DocsFrameSaveBlocked | null>(saveBlocked);
  if (saveBlocked !== null && saveBlocked !== lastBlocked) {
    setLastBlocked(saveBlocked);
  }
  const active = saveBlocked ?? lastBlocked;
  const max = active ? formatDocumentSizeMB(active.maxBytes, i18n.language) : "";
  return (
    <Dialog open={saveBlocked !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        aria-describedby="office-save-blocked-description"
        initialFocus={downloadRef}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("office.size.save_blocked.title")}</DialogTitle>
          <DialogDescription id="office-save-blocked-description">
            {active ? t("office.size.save_blocked.body", { max }) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDismiss}>
            {t("office.size.save_blocked.close")}
          </Button>
          <Button ref={downloadRef} type="button" onClick={onDownload}>
            {t("office.size.save_blocked.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
