import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { cn } from "@uniwork/ui/lib/utils";
import type { ReadOnlyReason } from "../tabs/use-document-tabs";

/** The one neutral notice for a cloud document opened view-only because of its
 * format's Office flag: switched off by the organization (`feature_off`), or not
 * known yet because the flags answer has not loaded (`flags_unknown`). Neither is
 * a permission problem nor an error, so it uses the info tokens (the same soft
 * tone as the shared `Notice`, built from the Alert primitive because this host
 * does not depend on the icon set). */
export function FeatureOffNotice({ formatName, reason = "feature_off", className }: { formatName: string; reason?: ReadOnlyReason; className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const unknown = reason === "flags_unknown";
  return (
    <Alert role="status" className={cn("w-auto max-w-full border-0 bg-info-soft text-info-soft-foreground", className)} data-testid="office-feature-off" data-reason={reason}>
      <AlertTitle>{t(unknown ? "flagsUnknownTitle" : "featureOffTitle", { format: formatName })}</AlertTitle>
      <AlertDescription className="text-info-soft-foreground">{t(unknown ? "flagsUnknownDescription" : "featureOffDescription", { format: formatName })}</AlertDescription>
    </Alert>
  );
}
