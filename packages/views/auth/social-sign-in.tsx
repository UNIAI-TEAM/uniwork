"use client";
import { useTranslation } from "react-i18next";
import type { AuthProviders, SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useAuthProviders } from "@uniwork/core/auth";
import { paths, type ProviderStartOptions } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AppleMark, GoogleMark } from "../common/provider-icons";
import { AUTH_PILL } from "./auth-controls";

/**
 * The providers this deployment offers on the web, in the order their buttons
 * stand. `google` is the web's Google; Apple on the web is `apple_web`, since
 * `apple` still means the iPhone's own sheet (spec §3.8) and a deployment can
 * have that without the Services ID the browser flow needs.
 */
export function webSignInProviders(providers: AuthProviders | undefined): SignInProvider[] {
  const offered: SignInProvider[] = [];
  if (providers?.google) offered.push("google");
  if (providers?.apple_web) offered.push("apple");
  return offered;
}

/** The API route a provider's sign-in leaves from (an absolute URL, not a page). */
export function providerStartUrl(provider: SignInProvider, opts: ProviderStartOptions): string {
  return provider === "google" ? paths.googleStart(opts) : paths.appleStart(opts);
}

/**
 * Apple's HIG: white with an outline on a light page (the outline pill as it
 * is), white with a black label on a dark one. Semantic tokens, not black and
 * white: in dark mode foreground is the near-white and background the
 * near-black. The `dark:` classes replace the outline variant's own through
 * cn(), and hover keeps the label on its fill, where the variant's
 * `hover:text-foreground` would paint it the colour of the button.
 */
const APPLE_PILL =
  "dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground/90 dark:hover:text-background";

const MARKS: Record<SignInProvider, typeof GoogleMark> = {
  google: GoogleMark,
  apple: AppleMark,
};

/** The pills' own sizes: the Apple glyph is taller than the G, and its bite sits high, so it rides 1px up. */
const MARK_SIZE: Record<SignInProvider, string> = {
  google: "size-4",
  apple: "size-[1.125rem] -translate-y-px",
};

const LABEL: Record<SignInProvider, string> = {
  google: "auth.social.continueWithGoogle",
  apple: "auth.social.continueWithApple",
};

/** What a provider adds to the outline pill: Apple's colours on a dark page. */
export function providerPillClass(provider: SignInProvider): string | undefined {
  return provider === "apple" ? APPLE_PILL : undefined;
}

/**
 * A provider pill's face, its mark and "Continue with …": the links below,
 * and the UniChat shell's buttons, which start the same sign-in through the
 * system browser. `busy` puts a spinner where the mark stands.
 */
export function ProviderPillFace({ provider, busy = false }: { provider: SignInProvider; busy?: boolean }) {
  const { t } = useTranslation();
  const Mark = MARKS[provider];
  return (
    <>
      {busy ? <Spinner className="size-4" /> : <Mark className={MARK_SIZE[provider]} />}
      {t(LABEL[provider])}
    </>
  );
}

/**
 * "Continue with Google" and "Continue with Apple" above a login or register
 * form, then "or use email" over the form: the order the phone shows too, so
 * every platform reads the same way in (spec §4.1). Each is a plain anchor to
 * the API's start route, not the Button primitive: it is a navigation to
 * another origin, and the browser comes back through /auth/callback (or the
 * choice screen) with the cookie already set. Links, not buttons, also keeps
 * one button named "Đăng nhập" on /login and one "Đăng ký" on /register.
 *
 * A provider the deployment does not offer has no button (a self-hosted
 * instance without credentials never shows one that would 503), and with
 * none offered the block is gone, divider included.
 *
 * While /auth/providers is in flight the space for two buttons and the divider
 * is held, invisibly: on a slow connection the block used to land seconds
 * later and push the form out from under a thumb already on its way. No
 * skeleton pulse: a placeholder that flashes for 200ms is worse than one that
 * is simply not there yet.
 *
 * `except` is the provider a pending sign-in waits to link (/login?link=1,
 * spec §4.4): its own button would only start the same sign-in again, so it
 * is left out and the other one stays. `hold` keeps the placeholder while the
 * caller is still learning which one that is, so neither button flashes.
 */
export function SocialSignIn({
  next,
  intent,
  except = null,
  hold = false,
}: Pick<ProviderStartOptions, "next" | "intent"> & { except?: SignInProvider | null; hold?: boolean }) {
  const { t } = useTranslation();
  const providers = useAuthProviders();
  if (providers.isPending || hold) {
    return (
      <div aria-hidden data-slot="social-placeholder" className="invisible flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          {/* Two at most, one when the pending provider's is left out. */}
          <div className="h-12" />
          {except || hold ? null : <div className="h-12" />}
        </div>
        <div className="h-4" />
      </div>
    );
  }
  const offered = webSignInProviders(providers.data).filter((provider) => provider !== except);
  if (offered.length === 0) return null;
  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label={t("auth.social.groupLabel")} className="flex flex-col gap-3">
        {offered.map((provider) => (
          <a
            key={provider}
            href={providerStartUrl(provider, { next, intent })}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), AUTH_PILL, "gap-2.5", providerPillClass(provider))}
          >
            <ProviderPillFace provider={provider} />
          </a>
        ))}
      </div>
      <div className="flex items-center gap-3 text-caption text-muted-foreground">
        <Separator className="flex-1" />
        <span>{t("auth.social.divider")}</span>
        <Separator className="flex-1" />
      </div>
    </div>
  );
}
