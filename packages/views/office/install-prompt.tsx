"use client";

import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";

export type OfficeInstallChannel = "dev" | "beta" | "stable";
export type OfficeInstallerURLs = Record<OfficeInstallChannel, string>;

export interface OfficeInstallPromptProps {
  open: boolean;
  channel: OfficeInstallChannel;
  installers: OfficeInstallerURLs;
  onOpenChange: (open: boolean) => void;
  onOpenAgain: () => void;
  reason?: "not-installed" | "expired" | "error";
}

function validInstallerURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.host);
  } catch {
    return false;
  }
}

/** Explains the best-effort custom-scheme result without claiming that the
 * desktop app opened. Stable stays unavailable until a configured signed
 * artifact exists; it never falls back to a dev installer. */
export function OfficeInstallPrompt({
  open,
  channel,
  installers,
  onOpenChange,
  onOpenAgain,
  reason = "not-installed",
}: OfficeInstallPromptProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.desktop.install" });
  const installer = installers[channel];
  const canInstall = validInstallerURL(installer);
  const reasonKey = reason === "expired" ? "expired" : reason === "error" ? "error" : "not_installed";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="office-install-description">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription id="office-install-description">{t(reasonKey)}</DialogDescription>
        </DialogHeader>
        {!canInstall ? <Alert role="status"><AlertDescription>{t("unavailable")}</AlertDescription></Alert> : null}
        <DialogFooter className="sm:flex-col sm:items-stretch">
          <Button type="button" onClick={onOpenAgain}>{t("open_again")}</Button>
          {canInstall ? (
            <ButtonLink href={installer} target="_blank" rel="noreferrer" variant="outline">{t("install")}</ButtonLink>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
