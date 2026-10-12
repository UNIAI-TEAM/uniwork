"use client";
import { useTranslation } from "react-i18next";
import { useAuthProviders } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { GoogleMark } from "../common/provider-icons";
import { AUTH_PILL } from "./auth-controls";

/**
 * "Continue with Google" under a login/register form. A plain anchor to the
 * API's start route: the browser leaves for Google from there and comes back
 * through /auth/callback with a session cookie already set. Renders nothing
 * once the deployment says it has no Google, so a self-hosted instance
 * without credentials never shows a button that would 503.
 *
 * While the answer is in flight the block's space is held, invisibly: this
 * sits between the primary button and the links, and on a slow connection it
 * used to land seconds later and push "Đăng ký" out from under a thumb that
 * was already on its way. No skeleton pulse — a placeholder that flashes for
 * 200ms is worse than one that is simply not there yet.
 */
export function GoogleButton({ next }: { next?: string | null }) {
  const { t } = useTranslation();
  const providers = useAuthProviders();
  if (providers.isPending) {
    return (
      <div aria-hidden data-slot="google-placeholder" className="invisible flex flex-col gap-4">
        <div className="h-4" />
        <div className="h-12" />
      </div>
    );
  }
  if (!providers.data?.google) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-caption text-muted-foreground">
        <Separator className="flex-1" />
        <span>{t("auth.google.or")}</span>
        <Separator className="flex-1" />
      </div>
      {/* A plain anchor styled as a button, not the Button primitive: this is
          a navigation to another origin, and Base UI's Button would layer
          button semantics (role, key handling) over the link either way. */}
      <a
        href={paths.googleStart(next)}
        className={cn(buttonVariants({ variant: "outline", size: "lg" }), AUTH_PILL)}
      >
        <GoogleMark className="size-4" />
        {t("auth.google.continueWith")}
      </a>
    </div>
  );
}
