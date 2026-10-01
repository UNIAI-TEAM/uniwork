import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { cn } from "@uniwork/ui/lib/utils";

export type DesktopRecoveryState = "conflict" | "blocked" | "locked" | "unavailable";

/** Desktop blocked/locked recovery notice built from the shared Alert registry
 * primitive and the shared office.recovery vocabulary with t(). The views
 * save-status entry point is not on this host's browser-safe allowlist, so the
 * same primitive and copy are used directly instead of importing it. */
export function RecoveryNotice({ state, className }: { state: DesktopRecoveryState; className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.recovery" });
  return (
    <Alert variant={state === "unavailable" ? "default" : "destructive"} className={cn("max-w-full", className)} data-testid={`office-recovery-${state}`}>
      <AlertTitle>{t(state)}</AlertTitle>
      <AlertDescription>{t("description")}</AlertDescription>
    </Alert>
  );
}
