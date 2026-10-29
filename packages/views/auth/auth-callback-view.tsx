"use client";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/**
 * The wait between a provider (Google, Apple) and the screen the sign-in leads
 * to, while the callback page resolves the session. It names no provider: the
 * page cannot know which one sent the browser back, and every provider lands
 * here. The silver shell plane the sign-in screens stand on, the mark, one
 * line; nothing else.
 *
 * The plane paints at once, so the provider's page gives way to the same
 * ground the sign-in started from. The mark and the line fade in only after a
 * beat: most callbacks resolve before it, and a status that flashes for 200ms
 * reads as a glitch. They are in the tree from the start, so a screen reader
 * hears the status either way.
 */
export function AuthCallbackView() {
  const { t } = useTranslation();
  return (
    <main className="flex h-dvh items-center justify-center bg-app-shell px-4 text-muted-foreground">
      <div className="flex animate-in flex-col items-center gap-6 fade-in fill-mode-backwards duration-500 [animation-delay:400ms] motion-reduce:animate-none">
        <Logo variant="mark" size={40} decorative />
        <div role="status" className="flex items-center gap-2.5 text-body">
          {/* The text is the announcement; the icon must not add a second
              (English) status of its own. */}
          <Spinner role="presentation" aria-label={undefined} aria-hidden />
          {/* The only content on the page doubles as its heading. */}
          <h1 className="text-body font-normal">{t("auth.social.signingIn")}</h1>
        </div>
      </div>
    </main>
  );
}
