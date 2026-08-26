"use client";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { cn } from "@uniwork/ui/lib/utils";
import { BrandRail, BrandRailAside, RAIL_COLUMN, RAIL_GUTTER, RAIL_WIDTH_AUTH } from "../layout/brand-rail";

/**
 * The shell both credential screens share, built on the same rail as
 * onboarding. Login is the screen immediately before onboarding, so it is laid
 * out on the same two columns and measured with the same ruler: signing in and
 * being walked through setup should read as one continuous surface, not as a
 * plain form that hands off to a designed one.
 *
 * `<main>` because these routes render no other landmark: without it a screen
 * reader's landmark list is empty and there is nothing to skip to.
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
  const { t } = useTranslation();
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <BrandRailAside width={RAIL_WIDTH_AUTH}>
          <BrandRail
            header={
              <span className="flex min-w-0 items-center gap-2">
                <Logo variant="mark" tone="mono" size={20} decorative />
                <span className="truncate text-label font-medium text-foreground">{t("auth.wordmark")}</span>
              </span>
            }
          >
            {/* Serif, in the onboarding welcome's voice, and centred rather than
                pinned to the floor: the rail is proportional now, so a sentence
                on the bottom edge leaves a column of empty dot field above it.
                Centred, it lands on the same optical line as the form opposite. */}
            <p className="my-auto max-w-[22rem] text-balance font-serif text-title-lg font-medium leading-snug text-foreground lg:text-display-sm">
              {t("auth.railTagline")}
            </p>
          </BrandRail>
        </BrandRailAside>

        <main className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", RAIL_GUTTER)}>
          <div className={cn(RAIL_COLUMN, "animate-onboarding-enter justify-center gap-8")}>
            <div className="flex flex-col gap-1.5">
              {/* Below `md` the rail is gone, so the lockup here is the only
                  place the product names itself. */}
              <Logo variant="lockup" size={26} className="mb-5 md:hidden" />
              <h1 className="text-balance text-display-sm font-semibold text-foreground sm:text-hero-sm">{title}</h1>
              <p className="text-pretty text-body-lg text-muted-foreground">{description}</p>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
