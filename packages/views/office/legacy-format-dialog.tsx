"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { DesktopOpenAction, type DesktopOpenActionProps } from "./desktop-open-action";
import type { FrameDesktopOpenProps } from "./frame";

export type LegacyFormatDesktopOpenProps = Omit<
  DesktopOpenActionProps,
  "documentId" | "dirty" | "saveCoordinator" | "placement" | "savedVersion"
> & {
  savedVersion?: number | null;
};

export interface LegacyFormatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  /** The current version ordinal of the document; defaults to `desktopOpen.savedVersion ?? 1`. */
  savedVersion?: number | null;
  /** A historical version ordinal to open read-only in the desktop app. */
  version?: number;
  /** `edit` or `view` for the current version; historical versions always request `view`. */
  operation?: "edit" | "view";
  /** Host wiring for `DesktopOpenAction` (launch session, deep link, and install prompt). */
  desktopOpen?: FrameDesktopOpenProps | LegacyFormatDesktopOpenProps;
}

/**
 * Web modal for legacy `.doc`, `.xls`, and `.ppt` files (UNI-2209): explains
 * that the file is an older Office format that opens in UniWork Office on the
 * computer, offers "Mở bằng UniWork Office" through `DesktopOpenAction` (which
 * opens `OfficeInstallPrompt` when the app is not installed), and has no
 * download button (download remains in the document menu).
 */
export function LegacyFormatDialog({
  open,
  onOpenChange,
  documentId,
  savedVersion,
  version,
  operation = "edit",
  desktopOpen,
}: LegacyFormatDialogProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.legacy" });
  const resolvedSavedVersion = savedVersion ?? desktopOpen?.savedVersion ?? (version ?? 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        aria-describedby="office-legacy-format-description"
        data-testid="legacy-format-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription id="office-legacy-format-description">
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
          <DesktopOpenAction
            {...desktopOpen}
            deploymentId={desktopOpen?.deploymentId}
            documentId={documentId}
            savedVersion={resolvedSavedVersion}
            version={version}
            operation={version ? "view" : operation}
            placement="dialog"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
