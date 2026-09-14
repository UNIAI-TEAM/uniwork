"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { cn } from "@uniwork/ui/lib/utils";
import { BrandRail, BrandRailAside, RAIL_COLUMN, RAIL_GUTTER, RAIL_WIDTH_AUTH } from "../layout/brand-rail";
import { LocaleSwitch } from "./locale-switch";

/**
 * The shell both credential screens share, built on the same rail as
 * onboarding. Login is the screen immediately before onboarding, so it is laid
 * out on the same two columns and measured with the same ruler: signing in and
 * being walked through setup should read as one continuous surface, not as a
 * plain form that hands off to a designed one.
 *
 * `<main>` because these routes render no other landmark: without it a screen
 * reader's landmark list is empty and there is nothing to skip to.
 *
 * When the title changes (login → verify, forgot → sent, reset → expired) the
 * form the user was in unmounts and focus would drop to `<body>`; the heading
 * takes it instead so the new screen is announced. First render is left alone
 * so a field's `autoFocus` still wins.
 *
 * The tab title follows the heading ("Đăng nhập · UniWork"): a screen-reader
 * user hears which page this is before the heading, and a sighted one can tell
 * the login tab from the workspace tab. Set here, on the client, because these
 * routes are client pages and their title is in the user's language.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef({ title, language: i18n.language });
  useEffect(() => {
    const languageChanged = previous.current.language !== i18n.language;
    const titleChanged = previous.current.title !== title;
    previous.current = { title, language: i18n.language };
    // A language switch also rewrites the title, but the user is still on the
    // same screen with a hand on the switch; stealing focus to the heading
    // would drop a keyboard user in the middle of the page. `html[lang]` and
    // the switch's own relabelled text already say what happened.
    if (languageChanged || !titleChanged) return;
    heading.current?.focus();
  }, [title, i18n.language]);
  useEffect(() => {
    document.title = `${title} · ${t("auth.wordmark")}`;
  }, [title, t]);
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <BrandRailAside width={RAIL_WIDTH_AUTH}>
          <BrandRail
            // The generated lockup, not the mark beside typed text: the brand
            // README forbids retyping the wordmark in Inter (the W's feet are
            // drawn), and the phone layout below already uses the lockup, so
            // this is one logo across breakpoints rather than two. `mono` is
            // the only tone that survives a dark panel without restating it.
            header={
              <>
                <Logo variant="lockup" tone="mono" size={22} />
                <LocaleSwitch className="-mr-2" />
              </>
            }
          >
            {/* Serif, in the onboarding welcome's voice, and centred rather than
                pinned to the floor: the rail is proportional now, so a sentence
                on the bottom edge leaves a column of empty dot field above it.
                Centred, it lands on the same optical line as the form opposite.
                Regular weight and the same 24px as the form's heading: a brand
                statement beside the headline, not a second headline. */}
            <p className="my-auto max-w-[22rem] text-balance font-display text-title-lg leading-snug text-foreground lg:text-display-sm">
              {t("auth.railTagline")}
            </p>
          </BrandRail>
        </BrandRailAside>

        <main className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", RAIL_GUTTER)}>
          <div className={cn(RAIL_COLUMN, "animate-onboarding-enter justify-center gap-8")}>
            <div className="flex flex-col gap-1.5">
              {/* Below `md` the rail is gone, so the lockup here is the only
                  place the product names itself, and the language switch has
                  to come along with it. */}
              <div className="mb-5 flex items-center justify-between md:hidden">
                <Logo variant="lockup" size={26} />
                <LocaleSwitch className="-mr-2" />
              </div>
              {/* 24px at every width. It was 36px from `sm` up, which made a
                  two-word heading the loudest thing on a screen whose form is
                  set in 14px, and changed size between a phone and a tablet
                  for no reason a user could see. Three sizes on this screen:
                  this, the body, and nothing else. */}
              <h1
                ref={heading}
                tabIndex={-1}
                className="text-balance text-display-sm font-semibold tracking-tight text-foreground"
              >
                {title}
              </h1>
              {/* Descriptions carry user strings (an email address) that have no
                  break opportunity; without this a long one scrolls the phone. */}
              <p className="text-pretty text-body text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
