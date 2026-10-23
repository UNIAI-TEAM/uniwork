"use client";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalNavigation } from "../../navigation";

/**
 * The switch-account escape hatch: on the lockup row of Welcome and in the
 * rail footer of the other steps. Always inside a landmark, never `fixed`.
 *
 * Held once pressed, until the page changes: a second tap would sign out an
 * account that is already signed out. Held the aria-disabled way, so it stays
 * in the tab order and says it is working.
 */
export function OnboardingLogoutButton({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const logout = useLogout();
  const nav = useOptionalNavigation();
  const busy = logout.isPending || logout.isSuccess;
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-2 w-fit shrink-0 text-muted-foreground hover:text-foreground", className)}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={() => {
        if (busy) return;
        logout.mutate(undefined, { onSuccess: () => nav?.replace(paths.login()) });
      }}
    >
      {busy ? <Spinner className="size-4" /> : <LogOut aria-hidden className="size-4" />}
      {t("onboarding.common.log_out")}
    </Button>
  );
}
