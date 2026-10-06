import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { cn } from "@uniwork/ui/lib/utils";
import type { ReadOnlyReason } from "../tabs/use-document-tabs";

const COPY: Record<ReadOnlyReason, readonly [title: string, description: string]> = {
  feature_off: ["featureOffTitle", "featureOffDescription"],
  flags_unknown: ["flagsUnknownTitle", "flagsUnknownDescription"],
  view_only: ["viewOnlyTitle", "viewOnlyDescription"],
  gone: ["goneTitle", "goneDescription"],
};

/** The one neutral notice for a cloud document opened view-only for a reason that
 * is not an error: its format's Office flag switched off by the organization
 * (`feature_off`), the flags answer not loaded yet (`flags_unknown`), or, after
 * the upgrade re-read, the reader's access dropped to view (`view_only`) or the
 * document was deleted or moved (`gone`). It uses the info tokens (the same soft
 * tone as the shared `Notice`, built from the Alert primitive because this host
 * does not depend on the icon set). */
export function FeatureOffNotice({ formatName, reason = "feature_off", className }: { formatName: string; reason?: ReadOnlyReason; className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [title, description] = COPY[reason];
  return (
    <Alert role="status" className={cn("w-auto max-w-full border-0 bg-info-soft text-info-soft-foreground", className)} data-testid="office-feature-off" data-reason={reason}>
      <AlertTitle>{t(title, { format: formatName })}</AlertTitle>
      <AlertDescription className="text-info-soft-foreground">{t(description, { format: formatName })}</AlertDescription>
    </Alert>
  );
}
