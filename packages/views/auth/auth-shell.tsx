"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks, Sparkles, Video, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Logo } from "@uniwork/ui/brand";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { BrandRailAside, RAIL_COLUMN, RAIL_GUTTER, RAIL_WIDTH_AUTH } from "../layout/brand-rail";
import { MODULE_TONES } from "../layout/module-tones";
import { LocaleSwitch } from "./locale-switch";

/**
 * The machined-tray container: a translucent outer shell with a hairline, a
 * padded gap, and the real surface seated inside it on concentric corners.
 * Outer radius is the ramp's 3xl; the inner one subtracts the 6px gap so the
 * curves stay parallel.
 */
function Bezel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-3xl bg-surface/55 p-1.5 ring-1 ring-border/60", className)}>
      <div className="rounded-[calc(var(--radius-3xl)-0.375rem)] bg-surface shadow-floating">{children}</div>
    </div>
  );
}

/**
 * Three things that run today, each in its module's tint. Stacked like cards
 * on a desk, slightly turned and overlapping. They are not controls, so they
 * do not answer the pointer.
 */
const RAIL_POINTS: { key: "tasks" | "meetings" | "ai"; icon: LucideIcon; tone: IconTileTone; place: string }[] = [
  { key: "tasks", icon: ListChecks, tone: MODULE_TONES.tasks, place: "ml-0 -rotate-2" },
  { key: "meetings", icon: Video, tone: MODULE_TONES.meetings, place: "-mt-4 ml-14 rotate-[1.5deg]" },
  { key: "ai", icon: Sparkles, tone: "brand", place: "-mt-4 ml-6 -rotate-1" },
];

/** Heavy, damped settle: the curve of the entrance on this screen. */
const SETTLE = [0.32, 0.72, 0, 1] as const;

/**
 * Rises once on arrival: up from below, out of a blur, into focus, each piece
 * a beat after the one before. The owner chose this slower, softer entrance
 * over the 200ms product default for the signed-out screens (2026-09-17). With
 * reduced motion it is simply there, and `filter` is cleared once settled
 * because a leftover `blur(0px)` is still a filter, and a filtered ancestor
 * becomes the containing block for anything fixed-position inside the form.
 */
function Rise({ index, children }: { index: number; children: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 40, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      transition={{ duration: 0.9, delay: 0.06 + index * 0.09, ease: SETTLE }}
    >
      {children}
    </motion.div>
  );
}

function RailCascade() {
  const { t } = useTranslation();
  return (
    // Dropped on laptop-height windows (768px and under), where the statement and
    // three cards would run past the bottom of a column that does not scroll.
    <ul className="flex w-full max-w-[26rem] flex-col [@media(max-height:48rem)]:hidden">
      {RAIL_POINTS.map(({ key, icon, tone, place }, i) => (
        <li key={key} className="relative" style={{ zIndex: i + 1 }}>
          <Rise index={i + 3}>
            <div
              className={place}
            >
              <Bezel>
                <div className="flex items-start gap-4 p-5">
                  {/* Hairline glyph: 1.5 instead of lucide's default 2, the
                      lighter line the raised cards call for. */}
                  <IconTile icon={icon} tone={tone} size="md" className="[&_svg]:stroke-[1.5]" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-body font-semibold text-foreground">{t(`auth.railPoints.${key}.title`)}</span>
                    <span className="text-pretty text-body text-muted-foreground">{t(`auth.railPoints.${key}.body`)}</span>
                  </div>
                </div>
              </Bezel>
            </div>
          </Rise>
        </li>
      ))}
    </ul>
  );
}

/**
 * The shell both credential screens share. Same two-column ruler as
 * onboarding (`BrandRailAside`, `RAIL_COLUMN`) so the form does not jump between
 * the two flows, but no panel: the page itself is the silver shell plane, the
 * statement sits on it directly, and the form is the one raised object. Login is the screen immediately before onboarding, so it is laid
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
    <div className="flex h-dvh min-h-0 flex-col bg-app-shell">
      <div className="relative flex min-h-0 flex-1">
        {/* Page chrome, not part of the statement: top right of the window, on
            the same line as the lockup. */}
        <LocaleSwitch className="absolute right-10 top-[2.375rem] z-10 hidden rounded-full lg:inline-flex" />
        <BrandRailAside width={RAIL_WIDTH_AUTH} from="lg">
          <div className="flex h-full flex-col px-6 pb-8 pt-5 lg:px-10">
            <header className="flex min-h-9 shrink-0 items-center">
              <Logo variant="lockup" size={28} />
            </header>
            <div className="my-auto flex flex-col gap-10 py-10">
              <div className="flex flex-col gap-5">
                <Rise index={0}>
                  <span className="inline-flex rounded-full bg-surface px-3 py-1 text-overline text-muted-foreground ring-1 ring-border/60">
                    {t("auth.railEyebrow")}
                  </span>
                </Rise>
                <Rise index={1}>
                  {/* A brand statement, not the title of a section: a <p>, so
                      the page's heading outline starts at the form's <h1>
                      instead of this line coming first. Hero scale steps with
                      the column: 36px at lg, 48px from xl, 60px from 2xl. */}
                  <p className="max-w-[34rem] text-balance font-display text-hero-sm font-bold text-foreground xl:text-hero 2xl:text-hero-lg">
                    {t("auth.railTagline")}
                  </p>
                </Rise>
                <Rise index={2}>
                  <p className="max-w-[30rem] text-pretty text-body-lg text-muted-foreground">{t("auth.railLede")}</p>
                </Rise>
              </div>
              <RailCascade />
            </div>
          </div>
        </BrandRailAside>

        <main className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", RAIL_GUTTER)}>
          <div className={cn(RAIL_COLUMN, "justify-center")}>
            {/* Below `lg` the aside is gone, so the lockup here is the only
                place the product names itself, and the language switch has to
                come along with it. */}
            <div className="mb-6 flex items-center justify-between lg:hidden">
              <Logo variant="lockup" size={28} />
              <LocaleSwitch className="-mr-2 rounded-full" />
            </div>
            <Rise index={1}>
              <Bezel>
                <div className="flex flex-col gap-8 p-6 sm:p-9">
                  <div className="flex flex-col gap-2">
                    <h1
                      ref={heading}
                      tabIndex={-1}
                      className="text-balance font-display text-display font-bold text-foreground outline-none"
                    >
                      {title}
                    </h1>
                    {/* Descriptions carry user strings (an email address) that
                        have no break opportunity; without this a long one
                        scrolls the phone. */}
                    <p className="text-pretty text-body text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
                  </div>
                  {children}
                </div>
              </Bezel>
            </Rise>
          </div>
        </main>
      </div>
    </div>
  );
}
