"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, type LucideIcon } from "lucide-react";
import { Logo } from "@uniwork/ui/brand";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { BrandRailAside, RAIL_COLUMN, RAIL_GUTTER, RAIL_WIDTH_AUTH } from "../layout/brand-rail";
import { Bezel, Rise } from "../layout/brand-surface";
import { MODULE_ICONS } from "../layout/module-icons";
import { MODULE_TONES } from "../layout/module-tones";
import { LocaleSwitch } from "./locale-switch";

/**
 * Three things that run today, each in its module's tint. Stacked like cards
 * on a desk, slightly turned and overlapping. They are not controls, so they
 * do not answer the pointer.
 */
const RAIL_POINTS: { key: "tasks" | "meetings" | "ai"; icon: LucideIcon; tone: IconTileTone; place: string }[] = [
  { key: "tasks", icon: MODULE_ICONS.tasks, tone: MODULE_TONES.tasks, place: "ml-0 -rotate-2" },
  { key: "meetings", icon: MODULE_ICONS.meetings, tone: MODULE_TONES.meetings, place: "-mt-4 ml-14 rotate-[1.5deg]" },
  { key: "ai", icon: Sparkles, tone: "brand", place: "-mt-4 ml-6 -rotate-1" },
];

function RailCascade() {
  const { t } = useTranslation();
  return (
    // Dropped on laptop-height windows (768px and under), where the statement and
    // three cards would run past the bottom of a column that does not scroll.
    <ul className="flex w-full max-w-[26rem] flex-col [@media(max-height:48rem)]:hidden">
      {RAIL_POINTS.map(({ key, icon, tone, place }, i) => (
        <li key={key} className="relative" style={{ zIndex: i + 1 }}>
          <Rise index={i + 2}>
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
 *
 * Without a `title` the screen cannot yet say which one it is (the session or
 * a list it depends on is still loading): the whole frame is already there —
 * landmark, lockup, language switch, an `<h1>` that says it is loading — and
 * the heading and description hold their place as skeleton lines. The first
 * real title that replaces it is an arrival, not a change, so it does not
 * take focus; the heading never shows one title and then flips to another.
 */
export function AuthShell({
  title,
  description,
  nameInTitle = false,
  announce = false,
  children,
}: {
  /** Absent while the screen is still resolving which one it is. */
  title?: string;
  description?: string;
  /**
   * The title carries a name of any length (an organization's). On a phone
   * it steps down one size, so "Chuyển sang <a long name>" takes two lines
   * instead of four and the screen's own content starts above the fold.
   */
  nameInTitle?: boolean;
  /**
   * The screen replaced another one in the middle of a task and has no field
   * of its own to focus (an access notice swapped in for the workspace): its
   * heading takes focus when it first shows, so the change is heard. Never
   * for a screen the person opened, where first render leaves focus alone.
   */
  announce?: boolean;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef<{ title: string | undefined; language: string } | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { title, language: i18n.language };
    if (title === undefined) return;
    // First render, or the first real title after the loading frame: an
    // arrival. Left alone so a field's `autoFocus` still wins.
    if (!before || before.title === undefined) {
      if (announce) heading.current?.focus();
      return;
    }
    // A language switch also rewrites the title, but the user is still on the
    // same screen with a hand on the switch; stealing focus to the heading
    // would drop a keyboard user in the middle of the page. `html[lang]` and
    // the switch's own relabelled text already say what happened.
    if (before.language !== i18n.language || before.title === title) return;
    heading.current?.focus();
  }, [title, i18n.language, announce]);
  useEffect(() => {
    if (title !== undefined) document.title = `${title} · ${t("auth.wordmark")}`;
  }, [title, t]);
  const loading = title === undefined;
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-app-shell">
      <div className="relative flex min-h-0 flex-1">
        {/* Page chrome, not part of the statement: top right of the window, on
            the same line as the lockup. */}
        <LocaleSwitch className="absolute right-10 top-8 z-10 hidden lg:inline-flex" />
        <BrandRailAside width={RAIL_WIDTH_AUTH} from="lg">
          <div className="flex h-full flex-col px-6 pb-8 pt-5 lg:px-10">
            <header className="flex min-h-9 shrink-0 items-center">
              <Logo variant="lockup" size={28} />
            </header>
            <div className="my-auto flex flex-col gap-10 py-10">
              <div className="flex flex-col gap-5">
                <Rise index={0}>
                  {/* A brand statement, not the title of a section: a <p>, so
                      the page's heading outline starts at the form's <h1>
                      instead of this line coming first. Hero scale steps with
                      the column: 36px at lg, 48px from xl, 60px from 2xl. No
                      eyebrow pill above it: the statement carries itself. */}
                  <p className="max-w-[34rem] text-balance font-display text-hero-sm font-bold text-foreground xl:text-hero 2xl:text-hero-lg">
                    {t("auth.railTagline")}
                  </p>
                </Rise>
                <Rise index={1}>
                  <p className="max-w-[30rem] text-pretty text-body-lg text-muted-foreground">{t("auth.railLede")}</p>
                </Rise>
              </div>
              <RailCascade />
            </div>
          </div>
        </BrandRailAside>

        <main aria-busy={loading || undefined} className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", RAIL_GUTTER)}>
          <div className={cn(RAIL_COLUMN, "justify-center")}>
            {/* Below `lg` the aside is gone, so the lockup here is the only
                place the product names itself, and the language switch has to
                come along with it. */}
            <div className="mb-6 flex items-center justify-between lg:hidden">
              <Logo variant="lockup" size={28} />
              <LocaleSwitch />
            </div>
            <Rise index={1}>
              <Bezel>
                <div className="flex flex-col gap-8 p-6 sm:p-9">
                  <div className="flex flex-col gap-2">
                    {/* No `outline-none`: when focus moves here after a
                        keyboard action the global :focus-visible outline marks
                        where it landed (a pointer action leaves it unmarked).
                        `overflow-wrap:anywhere` because the title can carry an
                        organization name with no break opportunity. */}
                    <h1
                      ref={heading}
                      tabIndex={-1}
                      className={cn(
                        loading
                          ? "sr-only"
                          : "rounded-sm text-balance font-display font-bold text-foreground [overflow-wrap:anywhere]",
                        !loading && (nameInTitle ? "text-display-sm sm:text-display" : "text-display"),
                      )}
                    >
                      {title ?? t("common.loading")}
                    </h1>
                    {loading ? (
                      <TitleSkeleton />
                    ) : (
                      /* Descriptions carry user strings (an email address) that
                         have no break opportunity; without this a long one
                         scrolls the phone. */
                      <p className="text-pretty text-body text-muted-foreground [overflow-wrap:anywhere]">
                        {description}
                      </p>
                    )}
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

/**
 * The heading and description lines while the title is unknown, each bar
 * sitting in a box of its line's height so nothing moves when the text lands.
 */
function TitleSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <div className="flex h-10 items-center">
        <Skeleton className="h-8 w-3/4" />
      </div>
      <div className="flex h-5 items-center">
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}
