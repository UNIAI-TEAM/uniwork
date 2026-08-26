"use client";
import { useRef, type ReactNode } from "react";
import { DotSphere } from "@uniwork/ui/components/ui/dot-sphere";
import { useCssVars } from "@uniwork/ui/hooks/use-css-var";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { withAlpha } from "@uniwork/ui/lib/utils";

/**
 * Canvas 2D does not accept `var()`, so the dot-sphere's colours must be real
 * strings. `useCssVars` reads them off the rail panel itself (which is scoped
 * `.dark`) instead of hardcoding them, so changing a token moves the rail with
 * it. The fallback only covers the first server-rendered frame.
 */
export const RAIL_VAR_FALLBACK = { "--rail": "#1b1b1f", "--brand": "#4d8dff" };

/**
 * The dark panel every signed-out screen is built on: onboarding puts its
 * stepper inside it, the credential screens put a tagline. It is chrome, not a
 * screen — it owns the panel, the dot field and the header/footer slots, and
 * nothing about what fills them.
 *
 * Extracted from the onboarding sidebar so login and onboarding cannot drift:
 * they are consecutive screens, and a panel that differed by a few pixels
 * between them would read as two products.
 */
export function BrandRail({
  header,
  footer,
  className,
  children,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const railVars = useCssVars(panelRef, RAIL_VAR_FALLBACK);
  // Two different hiding mechanisms, for two different problems — they were
  // once merged into one and both broke:
  //
  // LAYOUT hides in CSS. `useMediaQuery` returns `false` on the first render
  // (and under SSR) and only corrects itself in an effect, i.e. AFTER the
  // browser has painted. Gating the whole <aside> on it means every desktop
  // visit paints a frame with no rail, then 22rem jumps in — the `mx-auto`
  // content column slides ~11rem sideways once hydration lands. CSS applies
  // from the first pixel, with no jump at all.
  //
  // CANVAS hides in JS. `display:none` still mounts the subtree and still runs
  // every effect: the dot-sphere's rAF loop would spin at 60fps on a phone to
  // paint a 0x0 canvas. That has to be stopped at the React layer, and only
  // that.
  const showSphere = useMediaQuery("(min-width: 768px)");

  return (
    <div
      ref={panelRef}
      className={
        "dark relative isolate flex h-full w-full flex-col overflow-hidden rounded-2xl px-5 pb-5 text-foreground ring-1 ring-border" +
        (className ? " " + className : "")
      }
      style={{ background: "var(--rail)" }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {showSphere && (
          <DotSphere
            dotGap={19}
            motion="wave"
            sphereCount={5}
            sphereRadius="20%"
            dotRadiusMax={1.9}
            speed={0.4}
            bgColor={railVars["--rail"]}
            dotColor={withAlpha(railVars["--brand"], 0.5)}
          />
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col pt-5">
        {header ? <header className="flex min-h-9 shrink-0 items-center justify-between gap-3">{header}</header> : null}
        {children}
        {footer ? <footer className="flex min-h-8 shrink-0 items-end justify-between gap-4">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** One ruler for the content column beside the rail (28rem), and its gutter.
 *  Login and onboarding are consecutive screens; measuring them separately is
 *  how the form ends up a few pixels off between one and the next. */
export const RAIL_COLUMN = "mx-auto flex min-h-full w-full max-w-[28rem] flex-col";
export const RAIL_GUTTER = "px-6 py-8 sm:px-10 lg:px-14 lg:py-10";

/**
 * Width classes for the rail, per screen. There is no default on purpose: the
 * two screens want different proportions and a shared default would quietly
 * hand one of them the other's answer.
 *
 * Onboarding is FIXED because its right column is dense — four option cards and
 * a stepper — so the rail is a companion to real content and a wider one would
 * squeeze it.
 *
 * The credential screens are PROPORTIONAL because their right column holds
 * three controls. A fixed rail there shrinks to a strip as the window grows
 * (352px is 34% of a 1024px window and 18% of a 1920px one), and the form is
 * left adrift in the middle of the rest. `e2e/auth-layout.spec.ts` measures it.
 */
export const RAIL_WIDTH_ONBOARDING = "md:w-[19rem] lg:w-[22rem]";
export const RAIL_WIDTH_AUTH = "md:w-[36%] lg:w-[42%]";

/** The <aside> that positions the rail beside a content column. Hidden below `md`. */
export function BrandRailAside({ width, children }: { width: string; children: ReactNode }) {
  return <aside className={`hidden shrink-0 md:block md:p-3 lg:p-4 ${width}`}>{children}</aside>;
}
