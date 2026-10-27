"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * One-line reminder shown right before a Google Drive connect or reconnect
 * opens Google. Google's consent screen lists the file access permission as a
 * checkbox that starts unticked, so people who press Continue land on the
 * `scope_not_granted` notice. Every connect entry point renders this one
 * component so the sentence stays identical.
 */
export function DriveConsentHint({ className }: { className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.integrations.drive" });
  return (
    <p
      data-testid="drive-consent-hint"
      className={cn("text-caption text-pretty text-muted-foreground", className)}
    >
      {t("consent_hint")}
    </p>
  );
}
