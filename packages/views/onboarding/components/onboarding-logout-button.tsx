"use client";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Lối thoát đổi tài khoản. `fixed` chỉ ở màn Welcome (không có rail); các bước
 * khác truyền `inline` để nằm ở chân rail — rail scope `.dark` nên token
 * muted/primary tự đúng trên nền tối.
 */
export function OnboardingLogoutButton({ inline = false }: { inline?: boolean } = {}) {
  const { t } = useTranslation();
  const logout = useLogout();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        inline
          ? "-ml-2 w-fit shrink-0 text-text-secondary hover:text-primary"
          : "fixed right-8 top-8 z-50 text-text-secondary hover:text-danger",
      )}
      onClick={() => logout.mutate(undefined, { onSuccess: () => window.location.assign("/login") })}
    >
      <LogOut className="size-4" />
      {t("onboarding.common.log_out")}
    </Button>
  );
}
