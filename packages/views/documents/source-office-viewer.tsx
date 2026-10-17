"use client";

import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import type { OfficeModule, ProtocolErrorShape } from "@uniwork/core/office/docs-frame-protocol";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { OfficeModuleFrame, OfficeModuleOpenSwitch, OfficeTooLargeProvider } from "../office";
import { sourceOfficeModule } from "./source-links";

export interface SourceOfficeViewerProps {
  wsId: string;
  /** The source row's organization (the flag gates per org); absent treats the flag as unknown. */
  organizationId?: string;
  /** The installed build of a module ("" = none): the pinned version of the frame that opens the file. */
  frameVersion: (module: OfficeModule) => string;
  /** The row menu's own download: the fallback when no module or no build exists, and the action on a refused frame. */
  onDownload: (source: DocumentSourceFile) => void;
}

/**
 * The view-only Office viewer of a file from another module (UNI-1869): the
 * file opens in its genoffice module frame on a source token (`ofs1.`), never
 * editable — the read-only grant is structural (no write route accepts the
 * token) and the page strips save/save-as/download/desktop capabilities.
 * `open` resolves the module itself and answers false when nothing can host
 * the file (unknown format, no installed build), so the caller falls back to
 * the download it would have run. A session that cannot start (a refused
 * mint) toasts `preview_failed` and closes the dialog.
 */
export function useSourceOfficeViewer({ wsId, organizationId, frameVersion, onDownload }: SourceOfficeViewerProps): {
  open: (source: DocumentSourceFile) => boolean;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [view, setView] = useState<{ source: DocumentSourceFile; module: OfficeModule; version: string } | null>(null);

  const open = (source: DocumentSourceFile): boolean => {
    const module = sourceOfficeModule(source);
    if (!module) return false;
    const version = frameVersion(module);
    if (!version) return false;
    setView({ source, module, version });
    return true;
  };

  // A session that cannot start (mint refused, bundle missing, a handshake
  // that timed out) leaves nothing to read: the dialog closes and the row's
  // own words explain why.
  const onSessionFailure = (_failure: ProtocolErrorShape) => {
    setView(null);
    toast.error(t("documents.home.row.preview_failed"));
  };

  const dialog = (
    <Dialog open={view !== null} onOpenChange={(next) => { if (!next) setView(null); }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/70"
        className="flex h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-5xl"
        data-testid="source-office-viewer"
      >
        {view ? (
          <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
              <DialogTitle className="min-w-0 flex-1 truncate text-body font-medium">{view.source.name}</DialogTitle>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                {t("documents.home.row.view_only")}
              </span>
              <DialogClose
                render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("documents.home.row.preview_close")} />}
              >
                <X aria-hidden />
              </DialogClose>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <OfficeTooLargeProvider value={{ desktopAction: null, onDownload: () => onDownload(view.source) }}>
                <OfficeModuleOpenSwitch
                  module={view.module}
                  organizationId={organizationId}
                  frame={
                    <OfficeModuleFrame
                      module={view.module}
                      wsId={wsId}
                      fileRef={{ kind: "source", id: view.source.id }}
                      title={view.source.name}
                      frameVersion={view.version}
                      onSessionFailure={onSessionFailure}
                    />
                  }
                />
              </OfficeTooLargeProvider>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );

  return { open, dialog };
}
