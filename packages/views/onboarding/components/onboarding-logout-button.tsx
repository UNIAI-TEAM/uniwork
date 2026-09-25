"use client";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalNavigation } from "../../navigation";

/**
 * The switch-account escape hatch: on the lockup row of Welcome and in the
 * rail footer of the other steps. Always inside a landmark, never `fixed`.
 */
export function OnboardingLogoutButton({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const logout = useLogout();
  const nav = useOptionalNavigation();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-2 w-fit shrink-0 text-muted-foreground hover:text-foreground", className)}
      onClick={() => logout.mutate(undefined, { onSuccess: () => nav?.replace(paths.login()) })}
    >
      <LogOut className="size-4" />
      {t("onboarding.common.log_out")}
    </Button>
  );
}
