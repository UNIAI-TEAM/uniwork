import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { cn } from "@uniwork/ui/lib/utils";

/** The one neutral notice for a cloud document opened view-only because its
 * format's Office flag is off. Not a permission problem and not an error, so it
 * uses the info tokens (the same soft tone as the shared `Notice`, built from
 * the Alert primitive because this host does not depend on the icon set). */
export function FeatureOffNotice({ formatName, className }: { formatName: string; className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  return (
    <Alert role="status" className={cn("w-auto max-w-full border-0 bg-info-soft text-info-soft-foreground", className)} data-testid="office-feature-off">
      <AlertTitle>{t("featureOffTitle", { format: formatName })}</AlertTitle>
      <AlertDescription className="text-info-soft-foreground">{t("featureOffDescription", { format: formatName })}</AlertDescription>
    </Alert>
  );
}
