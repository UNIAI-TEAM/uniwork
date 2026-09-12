"use client";
import { ArrowRight, Sparkles, Video } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS, href } from "./anchors";
import { useArtwork } from "./artwork";
import { gsap, useGSAP } from "./animation/register-gsap";
import { DURATION, EASE, RISE, STAGGER, withMotionPreference } from "./animation/reveal";
import { Container } from "./layout-primitives";

/**
 * The section is sized so the whole hero clears a 900px viewport under the
 * header rather than filling it: the copy lost four elements and a container
 * tall enough for the old stack now centres a short one halfway down the
 * screen, which reads as a layout fault and not as space.
 *
 * Four elements and no more: eyebrow, headline, subhead, two buttons. The three
 * check-marked claims that used to sit under the buttons now open the trust
 * band, where each one has room for the sentence that makes it checkable. A
 * hero that carries its own feature list stops being a single moment.
 *
 * The photograph runs off the right edge behind the copy on wide viewports and
 * moves below the fold on phones, where a 68%-wide background would leave the
 * headline sitting on faces. Two <Image> instances rather than one repositioned
 * element: they have different aspect ratios and different `sizes`, and only
 * the visible one is fetched.
 */
export function Hero() {
  const { t } = useTranslation();
  // Routed through the resolver even though the hero has no lettering and one
  // file: the day it gains a word, the src stops being right in one language
  // and nothing here would say so.
  const artwork = useArtwork();
  const root = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLSpanElement>(null);
  const backdrop = useRef<HTMLImageElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = copy.current ? Array.from(copy.current.children) : [];
        if (!motion) {
          gsap.set([...lines, plus.current], { clearProps: "all" });
          return;
        }

        // The one elaborate moment on the page. Children of the copy column in
        // document order (eyebrow, headline, subhead, buttons), so the stagger
        // follows the reading order without a list to maintain.
        gsap
          .timeline({ defaults: { duration: DURATION, ease: EASE } })
          .from(lines, { opacity: 0, y: RISE, stagger: STAGGER })
          // The plus lands a beat after the headline it belongs to. This is the
          // page's only overshoot; everything else settles straight.
          .from(plus.current, { scale: 0.6, opacity: 0, ease: "back.out(2)" }, "<0.25");

        // Parallax. The backdrop is pre-scaled so a ±3% drift never exposes an
        // edge, and both halves are transforms, so the scrub costs no layout.
        gsap.set(backdrop.current, { scale: 1.06 });
        gsap.fromTo(
          backdrop.current,
          { yPercent: -3 },
          {
            yPercent: 3,
            ease: "none",
            scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
          },
        );
      }),
    { scope: root },
  );

  return (
    <section
      ref={root}
      aria-labelledby="landing-title"
      className="relative isolate overflow-hidden pt-16 sm:pt-18 xl:min-h-[648px]"
    >
      {/* The photograph and the copy only share a row from `xl` up. Below that
          they stack: the scrim that protects the copy is anchored to the copy
          column's real edge (gutter + 42rem), and on a narrower viewport that
          edge lands past where the photograph would have to start. Percentage
          stops used to hide this — at 768px the opaque zone ended at 284px
          while the copy ran to 672px, and the headline measured 1.1:1. */}
      <div className="absolute inset-y-0 right-0 -z-10 hidden w-[68%] xl:block">
        {/* `priority` on BOTH instances, not just the one below. Only one is
            ever in the layout, but which one is decided by a media query the
            server cannot evaluate, so neither can be the lazy one: from `xl`
            up this element IS the largest contentful paint, and it was being
            fetched lazily with no fetch priority. Next emits a preload for a
            priority image; the hidden instance costs a duplicate hint, not a
            duplicate download, because both resolve to the same URL. */}
        <Image
          ref={backdrop}
          src={artwork("hero")}
          alt={t("landing.hero.imageAlt")}
          fill
          priority
          sizes="68vw"
          className="object-cover object-[62%_center]"
        />
      </div>
      {/* Fades the photograph out under the copy. Uses the page ground so it
          stays correct in both themes without a second gradient. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 hidden bg-[linear-gradient(90deg,var(--background)_0,var(--background)_var(--hero-copy-edge),transparent_calc(var(--hero-copy-edge)+8rem))] xl:block"
        style={{ "--hero-copy-edge": "calc(max(0px, (100vw - 80rem) / 2) + 1.5rem + 42rem)" } as React.CSSProperties}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 -z-10 hidden h-40 bg-[linear-gradient(0deg,var(--background),transparent)] xl:block"
      />

      <Container className="flex items-center pb-10 pt-12 sm:py-16 xl:min-h-[576px] xl:py-14">
        <div ref={copy} className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-surface/80 px-3 py-1.5 text-caption font-semibold text-brand backdrop-blur">
            <Sparkles className="size-3.5" />
            {t("landing.hero.eyebrow")}
          </span>

          <h1
            id="landing-title"
            className="mt-5 font-heading text-hero font-bold leading-[1.05] sm:mt-6 sm:text-hero-lg lg:text-hero-xl"
          >
            {t("landing.hero.titleA")}{" "}
            <span ref={plus} className="inline-block text-brand">
              +
            </span>
            <br />
            <span className="text-brand-accent">{t("landing.hero.titleB")}</span>
          </h1>

          <p className="mt-5 max-w-xl text-body-lg leading-relaxed text-muted-foreground sm:mt-6 sm:text-title">
            {t("landing.hero.sub")}
          </p>

          <div className="mt-7 grid grid-cols-1 gap-3 min-[390px]:grid-cols-2 sm:mt-8 sm:flex sm:flex-wrap">
            <Link
              href={paths.register()}
              className={cn(buttonVariants({ size: "lg" }), "h-12 w-full px-5 text-body-lg sm:w-auto sm:px-6")}
            >
              {t("landing.cta.start")}
              <ArrowRight />
            </Link>
            <a
              href={href(ANCHORS.meetings)}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-12 w-full px-5 text-body-lg sm:w-auto sm:bg-surface/80 sm:px-6 sm:backdrop-blur",
              )}
            >
              <Video />
              {t("landing.cta.demo")}
            </a>
          </div>
        </div>
      </Container>

      <figure className="relative h-[360px] border-t border-border sm:h-[460px] xl:hidden">
        {/* Exactly one of the two instances is ever in the layout — the other
            is display:none — so both carry the real alt text without repeating
            it to a screen reader. Below xl this one is the hero image and the
            largest paint on the page; see the note on the backdrop above for
            why they are both `priority`. */}
        <Image
          src={artwork("hero")}
          alt={t("landing.hero.imageAlt")}
          fill
          priority
          sizes="100vw"
          className="object-cover object-[64%_center]"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(180deg,var(--background),transparent)]"
        />
      </figure>
    </section>
  );
}
