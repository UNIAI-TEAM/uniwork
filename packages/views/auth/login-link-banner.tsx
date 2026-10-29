"use client";
import { useTranslation } from "react-i18next";
import type { SignInTicket } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useDiscardSignInTicket, useSignInTicket } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { useNavigation } from "../navigation";
import { ProviderMark, identityAddress, useProviderName } from "./continue-parts";
import { pastLinkStep } from "./post-auth-redirect";

/**
 * /login?link=1 (spec §4.4): the choice screen's "Tôi đã có tài khoản UniWork".
 * The pending sign-in is asked of the server (its cookie is HttpOnly):
 * undefined while that answer is on its way, null when there is none any
 * more (expired, spent), and the page is then a plain sign-in.
 */
export function usePendingLink(link: boolean): SignInTicket | null | undefined {
  const ticket = useSignInTicket({ enabled: link });
  if (!link) return null;
  return ticket.isPending ? undefined : (ticket.data ?? null);
}

/** The banner's plane, shared with its loading shape so nothing moves when the text lands. */
const PLANE = "border-transparent bg-muted/50";

/**
 * Above the form: which provider waits to be linked, and "Không liên kết",
 * which drops the pending sign-in and the link mode with it; the page then
 * signs in to where the link step would have gone on to.
 *
 * A note (role=note), not a status: it is the fact this screen is about, read
 * in order before the form. While the pending sign-in loads, its two lines
 * and the button's row hold their place.
 */
export function LoginLinkBanner({ ticket, next }: { ticket: SignInTicket | null | undefined; next: string | null }) {
  const { t } = useTranslation();
  const { replace } = useNavigation();
  const discard = useDiscardSignInTicket();
  const provider = useProviderName(ticket?.provider);
  if (ticket === null) return null;
  if (ticket === undefined) {
    return (
      <div aria-hidden className={`grid gap-0.5 rounded-lg border px-2.5 py-2 ${PLANE}`}>
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-11/12" />
        </div>
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-1/2" />
        </div>
        <div className="flex min-h-5 items-center pointer-coarse:min-h-11">
          <Skeleton className="h-3.5 w-24" />
        </div>
      </div>
    );
  }
  const shown = identityAddress(ticket);
  return (
    <Alert role="note" className={PLANE}>
      <ProviderMark provider={ticket.provider} />
      <AlertDescription className="text-pretty text-foreground [overflow-wrap:anywhere]">
        {shown.kind === "address"
          ? t("auth.continue.loginMode.banner", { provider, email: shown.email })
          : t("auth.continue.loginMode.bannerRelay", { provider })}
      </AlertDescription>
      <div className="col-start-2">
        {/* Button primitive for the 44px coarse-pointer floor, drawn as the
            credential screens' inline link. The ticket goes without a wait:
            a sign-in that does not keep it drops it anyway (spec §3.2). */}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 text-label text-brand"
          onClick={() => {
            discard.mutate();
            replace(paths.login({ next: pastLinkStep(next) }));
          }}
        >
          {t("auth.continue.loginMode.decline")}
        </Button>
      </div>
    </Alert>
  );
}
