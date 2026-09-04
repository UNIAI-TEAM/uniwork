"use client";
import { useTranslation } from "react-i18next";
import { useAuthProviders } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Separator } from "@uniwork/ui/components/ui/separator";

/** Google's four-colour "G", inline so no third-party script or image is loaded. */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
    </svg>
  );
}

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
        <div className="h-10 pointer-coarse:h-11" />
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
        className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 w-full pointer-coarse:h-11")}
      >
        <GoogleMark />
        {t("auth.google.continueWith")}
      </a>
    </div>
  );
}
