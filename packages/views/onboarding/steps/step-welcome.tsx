"use client";
import { ArrowRight, Building2, LayoutGrid, ListChecks, Loader2, MessagesSquare, UserPlus, UserRound, Video, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ONBOARDING_STEP_ORDER } from "@uniwork/core/onboarding";
import { Logo } from "@uniwork/ui/brand";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_PILL } from "../../auth/auth-controls";
import { Bezel, Rise } from "../../layout/brand-surface";
import { MODULE_TONES } from "../../layout/module-tones";

type PlanStep = (typeof ONBOARDING_STEP_ORDER)[number];

const STEP_ICON: Record<PlanStep, LucideIcon> = {
  about_you: UserRound,
  organization: Building2,
  workspace: LayoutGrid,
  invite: UserPlus,
};

/**
 * What the next few minutes hold: the four real steps, in order, with the
 * labels the stepper will use once the person is inside. Not a picture of the
 * product and not anybody's data — the one thing this screen can say that is
 * both true and useful is what is about to be asked.
 */
function SetupPlan() {
  const { t } = useTranslation();
  return (
    <Bezel>
      <div className="flex flex-col p-6 sm:p-8 lg:pb-14">
        <div className="flex items-center justify-between gap-4 pb-5">
          <p className="text-overline uppercase text-muted-foreground">{t("onboarding.welcome.plan_title")}</p>
          <span className="rounded-full bg-brand-subtle px-2.5 py-0.5 text-caption font-medium text-brand-subtle-foreground">
            {t("onboarding.welcome.plan_meta", { count: ONBOARDING_STEP_ORDER.length })}
          </span>
        </div>
        <ol className="flex flex-col divide-y divide-border/60">
          {ONBOARDING_STEP_ORDER.map((step, i) => {
            const first = i === 0;
            return (
              <li key={step} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                <IconTile
                  icon={STEP_ICON[step]}
                  tone={first ? "brand" : "muted"}
                  size="md"
                  className="[&_svg]:stroke-[1.5]"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 text-body font-semibold text-foreground">
                    {t(`onboarding.step_nav.${step}.label`)}
                    {first ? (
                      <span className="text-caption font-medium text-brand">{t("onboarding.welcome.up_next")}</span>
                    ) : null}
                  </span>
                  <span className="text-pretty text-body text-muted-foreground">{t(`onboarding.step_nav.${step}.description`)}</span>
                </div>
                <span aria-hidden className="self-start pt-0.5 font-mono text-caption tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </Bezel>
  );
}

/**
 * A second sheet tucked under the plan, turned a little off the grid: the
 * modules the workspace will open onto, in their own tints. Wordless tiles and
 * one line of copy — decoration from `lg` up, gone on smaller screens where
 * the plan alone already runs long.
 */
const MODULES: { icon: LucideIcon; tone: (typeof MODULE_TONES)[keyof typeof MODULE_TONES] }[] = [
  { icon: ListChecks, tone: MODULE_TONES.tasks },
  { icon: Video, tone: MODULE_TONES.meetings },
  { icon: MessagesSquare, tone: MODULE_TONES.chat },
];

function ModuleSheet() {
  const { t } = useTranslation();
  return (
    <div aria-hidden className="relative z-10 -mt-9 ml-8 hidden w-fit max-w-[22rem] -rotate-[1.5deg] lg:block">
      <Bezel>
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex shrink-0 -space-x-1">
            {MODULES.map(({ icon, tone }, i) => (
              <IconTile key={i} icon={icon} tone={tone} variant="solid" size="sm" className="ring-2 ring-surface [&_svg]:stroke-[1.75]" />
            ))}
          </div>
          <p className="text-pretty text-body text-muted-foreground">{t("onboarding.welcome.illustration_caption")}</p>
        </div>
      </Bezel>
    </div>
  );
}

/**
 * Step 0: the first screen after sign-up, shown on every visit to onboarding
 * (the current step is not persisted). Same `app-shell` plane and the same
 * rising entrance as the sign-in screen, so sign-up → onboarding reads as one
 * surface. Left: the welcome and the CTA; right: the four real steps ahead.
 * `onSkip` is only passed when the user already has a workspace.
 */
export function StepWelcome({
  onNext,
  onSkip,
  headerEnd,
}: {
  onNext: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  /** The switch-account escape hatch, on the lockup's row. */
  headerEnd?: ReactNode;
}) {
  const { t } = useTranslation();
  // Whichever button is running gets the spinner; both are locked.
  const [pending, setPending] = useState<"next" | "skip" | null>(null);

  const run = async (which: "next" | "skip", fn?: () => void | Promise<void>) => {
    if (pending || !fn) return;
    setPending(which);
    try {
      await fn();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-app-shell">
      {/* Banner landmark: lockup + log out. The log-out button used to float
          `fixed` in the corner, outside every landmark. */}
      <header className="flex min-h-9 items-center justify-between gap-4 px-6 pt-6 sm:px-10 lg:px-14 lg:pt-8">
        <Logo variant="lockup" size={28} />
        {headerEnd}
      </header>

      {/* `<main>`: steps 1–4 get theirs from StepShell; the first screen
          needs a skip-to-content target too. */}
      <main className="flex flex-1 items-center px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
        <div className="mx-auto grid w-full max-w-[76rem] items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 xl:gap-24">
          <div className="flex max-w-[38rem] flex-col gap-8">
            <Rise index={0}>
              <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-overline uppercase text-muted-foreground ring-1 ring-border/60">
                <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                {t("onboarding.welcome.eyebrow")}
              </span>
            </Rise>

            <Rise index={1}>
              {/* 36px up to lg, 48px from xl, 60px from 2xl: the sign-in
                  statement's scale. 60px at 1280px broke the headline into
                  four narrow lines beside the plan card. */}
              <h1 className="text-balance font-display text-hero-sm font-bold text-foreground xl:text-hero 2xl:text-hero-lg">
                {t("onboarding.welcome.headline_line1")} {t("onboarding.welcome.headline_line2")}{" "}
                <span className="text-brand">{t("onboarding.welcome.headline_emphasis")}</span>
              </h1>
            </Rise>

            <Rise index={2}>
              <div className="flex max-w-[34rem] flex-col gap-3">
                <p className="text-pretty text-body-lg text-foreground">{t("onboarding.welcome.lede")}</p>
                <p className="text-pretty text-body text-muted-foreground">{t("onboarding.welcome.lede_secondary")}</p>
              </div>
            </Rise>

            <Rise index={3}>
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  size="lg"
                  onClick={() => run("next", onNext)}
                  aria-disabled={pending !== null || undefined}
                  className={cn(AUTH_PILL, "group/start justify-between gap-6 pl-6 pr-1.5 sm:w-auto")}
                >
                  <span>{t("onboarding.welcome.start")}</span>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-primary-foreground text-primary transition-transform duration-(--duration-standard) ease-out-quart group-hover/start:translate-x-0.5 group-hover/start:-translate-y-px motion-reduce:transition-none"
                  >
                    {pending === "next" ? (
                      <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <ArrowRight className="size-4" strokeWidth={1.75} />
                    )}
                  </span>
                </Button>
                {onSkip ? (
                  <Button
                    type="button"
                    size="lg"
                    variant="ghost"
                    onClick={() => run("skip", onSkip)}
                    aria-disabled={pending !== null || undefined}
                    className={cn(AUTH_PILL, "px-6 sm:w-auto")}
                  >
                    {pending === "skip" ? <Loader2 className="size-4 animate-spin" strokeWidth={1.75} /> : null}
                    {t("onboarding.welcome.skip_existing")}
                  </Button>
                ) : null}
              </div>
            </Rise>
          </div>

          <div className="flex w-full flex-col lg:max-w-[32rem] lg:justify-self-end">
            <Rise index={3}>
              <SetupPlan />
            </Rise>
            <Rise index={5}>
              <ModuleSheet />
            </Rise>
          </div>
        </div>
      </main>
    </div>
  );
}
