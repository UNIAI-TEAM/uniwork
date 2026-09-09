"use client";
import { Check, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { gsap, useGSAP } from "./animation/register-gsap";
import { DURATION, EASE, RISE, START, STAGGER, withMotionPreference } from "./animation/reveal";
import { Container, EmphasisSection, Eyebrow, SectionTitle } from "./layout-primitives";

export interface ProductBandProps {
  id: string;
  /** Flips the band to the emphasis plane; content then reads the dark palette. */
  emphasis?: boolean;
  /** Puts the copy column second on wide viewports. */
  reverse?: boolean;
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  /** Small image overlapping the main one; the band's one moment of depth. */
  companion?: string;
  companionAlt?: string;
  points?: readonly string[];
  action?: { label: string; href: string };
  /** Marks the band as a promise rather than a description of what ships. */
  soon?: string;
}

/**
 * The three product bands are one component so their rhythm cannot drift:
 * same column split, same image ratio, same vertical spacing. Only the
 * polarity, the side the copy sits on, and the optional companion image vary.
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

function ProductBandBody({
  emphasis,
  reverse,
  eyebrow,
  title,
  description,
  image,
  imageAlt,
  companion,
  companionAlt,
  points,
  action,
  soon,
}: ProductBandProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLElement>(null);
  const overlay = useRef<HTMLElement>(null);

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
        tl.from(lines, { opacity: 0, y: RISE, stagger: STAGGER })
          // The image arrives from the side the copy is NOT on, so the two
          // columns move toward each other rather than in parallel.
          .from(media.current, { opacity: 0, x: reverse ? -24 : 24 }, 0.1);
        if (overlay.current) {
          // This band's single accent: the overlapping card settles a beat
          // after the image it sits on, which is the only reason to notice it.
          tl.from(overlay.current, { opacity: 0, y: 12, ease: "power3.out" }, ">-0.35");
        }
      }),
    { scope: root },
  );

  return (
    <Container ref={root} className="grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-2 lg:gap-20">
      <div ref={copy} className={reverse ? "lg:order-2" : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <Eyebrow className={emphasis ? "text-brand" : "text-brand-accent"}>{t(eyebrow)}</Eyebrow>
          {soon ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-caption font-medium text-muted-foreground">
              {t(soon)}
            </span>
          ) : null}
        </div>
        <SectionTitle>{t(title)}</SectionTitle>
        <p className="mt-5 text-title-sm leading-relaxed text-muted-foreground">{t(description)}</p>

        {points ? (
          <ul className="mt-7 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex items-center gap-3 text-body">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
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

      <div className={cn("relative", reverse && "lg:order-1")}>
        {/* No border: --border sits at 1.04 against the dark-page emphasis
            band, so the edge has to come from radius and shadow instead. */}
        <figure
          ref={media}
          className="relative aspect-square overflow-hidden rounded-lg shadow-[var(--floating-shadow)]"
        >
          <Image
            src={image}
            alt={t(imageAlt)}
            fill
            sizes="(min-width: 1024px) 46vw, 100vw"
            className="object-cover"
          />
        </figure>
        {companion ? (
          <figure
            ref={overlay}
            className="absolute -bottom-6 -right-2 hidden aspect-[4/5] w-[42%] overflow-hidden rounded-lg border-4 border-surface bg-surface shadow-[var(--floating-shadow)] sm:block"
          >
            <Image
              src={companion}
              alt={companionAlt ? t(companionAlt) : ""}
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
