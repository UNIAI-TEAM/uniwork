"use client";
import { Check, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { useArtwork, type ArtworkName } from "./artwork";
import { gsap, useGSAP } from "./animation/register-gsap";
import { DURATION, EASE, RISE, START, STAGGER, withMotionPreference } from "./animation/reveal";
import { Container, EmphasisSection, SectionTitle } from "./layout-primitives";

export interface ProductBandProps {
  id: string;
  /** Flips the band to the emphasis plane; content then reads the dark palette. */
  emphasis?: boolean;
  /** Puts the copy column second on wide viewports. Ignored when `wide`. */
  reverse?: boolean;
  /**
   * Stacks the band instead of splitting it: headline and copy across the top,
   * the images as a wide asymmetric pair below. See the note above the
   * component for why exactly one band on the page uses this.
   */
  wide?: boolean;
  title: string;
  description: string;
  image: ArtworkName;
  imageAlt: string;
  /** Second image. Overlaps the first when split, sits beside it when `wide`. */
  companion?: ArtworkName;
  companionAlt?: string;
  points?: readonly string[];
  action?: { label: string; href: string };
  /** Marks the band as a promise rather than a description of what ships. */
  soon?: string;
}

/**
 * The three product bands are one component so their rhythm cannot drift:
 * same type scale, same vertical spacing, same motion. Only the polarity, the
 * side the copy sits on, and the composition vary.
 *
 * The middle band is `wide` and the two either side of it are splits. That is
 * the whole reason the variant exists: three copy-beside-image sections in a
 * row is the same sentence said three times, and the eye stops reading it by
 * the second. Breaking the middle one open also gives the band that has two
 * images somewhere to put both at full size, instead of shrinking one into a
 * corner of the other.
 *
 * The per-band eyebrow was removed rather than restyled. Six sections in a row
 * opening with the same small wide-tracked label is what makes a long page
 * read as a template; the headline already says what the section is, and the
 * section's place in the page says the rest.
 */
export function ProductBand(props: ProductBandProps) {
  const body = <ProductBandBody {...props} />;
  return props.emphasis ? (
    <EmphasisSection id={props.id} className="scroll-mt-16 sm:scroll-mt-18">
      {body}
    </EmphasisSection>
  ) : (
    <section id={props.id} className="scroll-mt-16 bg-surface sm:scroll-mt-18">
      {body}
    </section>
  );
}

function ProductBandBody(props: ProductBandProps) {
  const { t } = useTranslation();
  const artwork = useArtwork();
  const root = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLElement>(null);
  const overlay = useRef<HTMLElement>(null);
  const { wide, reverse } = props;

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = copy.current ? Array.from(copy.current.children) : [];
        if (!motion || !root.current) {
          gsap.set([...lines, media.current, overlay.current], { clearProps: "all" });
          return;
        }
        const scrollTrigger = { trigger: root.current, start: START, once: true };
        const tl = gsap.timeline({ defaults: { duration: DURATION, ease: EASE }, scrollTrigger });
        tl.from(lines, { opacity: 0, y: RISE, stagger: STAGGER });
        // Split bands bring the image in from the side the copy is NOT on, so
        // the two columns move toward each other. The wide band has no facing
        // column to move toward, so its images rise the way the copy did.
        tl.from(
          media.current,
          wide ? { opacity: 0, y: RISE } : { opacity: 0, x: reverse ? -24 : 24 },
          0.1,
        );
        if (overlay.current) {
          tl.from(overlay.current, { opacity: 0, y: 12, ease: "power3.out" }, ">-0.35");
        }
      }),
    { scope: root },
  );

  const heading = <BandCopy {...props} ref={copy} />;

  if (wide) {
    return (
      <Container ref={root} className="py-24 sm:py-32">
        {heading}
        <div className="mt-14 grid gap-5 sm:mt-16 lg:grid-cols-12 lg:gap-6">
          <figure
            ref={media}
            className="relative aspect-[4/3] overflow-hidden rounded-lg shadow-[var(--floating-shadow)] lg:col-span-7 lg:aspect-[16/11]"
          >
            <Image
              src={artwork(props.image)}
              alt={t(props.imageAlt)}
              fill
              sizes="(min-width: 1024px) 56vw, 100vw"
              className="object-cover"
            />
          </figure>
          {props.companion ? (
            <figure
              ref={overlay}
              className="relative aspect-[4/3] overflow-hidden rounded-lg shadow-[var(--floating-shadow)] lg:col-span-5 lg:aspect-[16/11]"
            >
              <Image
                src={artwork(props.companion)}
                alt={props.companionAlt ? t(props.companionAlt) : ""}
                fill
                sizes="(min-width: 1024px) 40vw, 100vw"
                className="object-cover"
              />
            </figure>
          ) : null}
        </div>
      </Container>
    );
  }

  return (
    <Container ref={root} className="grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-2 lg:gap-20">
      <div className={reverse ? "lg:order-2" : undefined}>{heading}</div>

      <div className={cn("relative", reverse && "lg:order-1")}>
        {/* No border: --border sits at 1.04 against the dark-page emphasis
            band, so the edge has to come from radius and shadow instead. */}
        <figure
          ref={media}
          className="relative aspect-square overflow-hidden rounded-lg shadow-[var(--floating-shadow)]"
        >
          <Image
            src={artwork(props.image)}
            alt={t(props.imageAlt)}
            fill
            sizes="(min-width: 1024px) 46vw, 100vw"
            className="object-cover"
          />
        </figure>
        {props.companion ? (
          <figure
            ref={overlay}
            className="absolute -bottom-6 -right-2 hidden aspect-[4/5] w-[42%] overflow-hidden rounded-lg border-4 border-surface bg-surface shadow-[var(--floating-shadow)] sm:block"
          >
            <Image
              src={artwork(props.companion)}
              alt={props.companionAlt ? t(props.companionAlt) : ""}
              fill
              sizes="(min-width: 1024px) 20vw, 42vw"
              className="object-cover"
            />
          </figure>
        ) : null}
      </div>
    </Container>
  );
}

/**
 * The copy column, identical in both compositions. It is the animation scope's
 * stagger target, so its children have to stay direct children: a wrapper
 * around the headline would collapse two beats into one.
 */
function BandCopy({
  ref,
  wide,
  title,
  description,
  points,
  action,
  soon,
}: ProductBandProps & { ref: React.Ref<HTMLDivElement> }) {
  const { t } = useTranslation();
  return (
    <div ref={ref} className={wide ? "max-w-3xl" : undefined}>
      {soon ? (
        <span className="inline-flex rounded-full border border-border px-2.5 py-0.5 text-caption font-medium text-muted-foreground">
          {t(soon)}
        </span>
      ) : null}
      <SectionTitle className={soon ? undefined : "mt-0"}>{t(title)}</SectionTitle>
      <p className="mt-5 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">{t(description)}</p>

      {points ? (
        <ul className={cn("mt-7 gap-3", wide ? "grid sm:grid-cols-3" : "grid")}>
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3 text-body-lg">
              <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                <Check className="size-3.5" />
              </span>
              {t(point)}
            </li>
          ))}
        </ul>
      ) : null}

      {action ? (
        <Link
          href={action.href}
          className={cn(buttonVariants({ variant: "link", size: "lg" }), "mt-7 px-0 text-brand")}
        >
          {t(action.label)}
          <ChevronRight />
        </Link>
      ) : null}
    </div>
  );
}
