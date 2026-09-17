"use client";
import type { ReactNode } from "react";
import { DotSphere } from "@uniwork/ui/components/ui/dot-sphere";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";

/**
 * The panel onboarding is built on: its stepper sits inside. (The credential
 * screens share only `BrandRailAside` and the column ruler.) It is chrome,
 * not a screen: it owns the panel, the dot field and the header/footer slots,
 * and nothing about what fills them.
 *
 * The fill is `bg-brand-subtle`, the same surface the app uses for a selected
 * row, so the first screen a person sees is already in the app's colours and
 * follows the theme and the accent picked in Themes. It used to be `bg-rail`
 * scoped `.dark`: a charcoal slab in a white app whose primary is violet.
 * Measured on this fill: foreground 15.6 / muted-foreground 5.1 (light),
 * foreground 14.9 / muted-foreground 6.0 / brand 5.9 (dark).
 *
 * The dot field is a still frame in `text-brand`, confined to the top edge of
 * the panel by the mask: the middle is where both screens put their text, and
 * dots inside the counters of a glyph read as dirt, not texture.
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
      className={
        "relative isolate flex h-full w-full flex-col overflow-hidden rounded-xl bg-brand-subtle px-6 pb-6 text-foreground" +
        (className ? " " + className : "")
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 text-brand [mask-image:linear-gradient(to_bottom,black_0%,black_12%,transparent_30%)]"
      >
        {showSphere && (
          <DotSphere
            dotGap={19}
            motion="wave"
            sphereCount={5}
            sphereRadius="20%"
            dotRadiusMax={1.9}
            dotAlpha={0.4}
            bgColor="transparent"
            animate={false}
          />
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col pt-6">
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
export const RAIL_WIDTH_AUTH = "lg:w-[42%]";

/**
 * The <aside> that positions the rail beside a content column, hidden below
 * `from`. Onboarding's rail is a narrow fixed stepper and fits from `md`; the
 * credential screens' statement column needs `lg` — at 768px its 36% share
 * was 276px, the headline broke over four lines and the feature cards ran off
 * the bottom of a tablet held upright.
 */
export function BrandRailAside({
  width,
  from = "md",
  children,
}: {
  width: string;
  from?: "md" | "lg";
  children: ReactNode;
}) {
  const shown = from === "lg" ? "lg:block lg:p-4" : "md:block md:p-3 lg:p-4";
  return <aside className={`hidden shrink-0 p-2 ${shown} ${width}`}>{children}</aside>;
}
