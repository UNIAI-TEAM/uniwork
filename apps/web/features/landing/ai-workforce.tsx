"use client";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS } from "./anchors";
import { useArtwork } from "./artwork";
import { gsap, useGSAP } from "./animation/register-gsap";
import { DURATION, EASE, START, STAGGER, withMotionPreference } from "./animation/reveal";
import { Container, Eyebrow, SectionTitle } from "./layout-primitives";

export function AiWorkforce() {
  const { t } = useTranslation();
  const artwork = useArtwork();
  const root = useRef<HTMLElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLImageElement>(null);
  const cta = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = intro.current ? Array.from(intro.current.children) : [];
        if (!motion || !root.current) {
          gsap.set([...lines, art.current, cta.current], { clearProps: "all" });
          return;
        }
        gsap
          .timeline({
            defaults: { duration: DURATION, ease: EASE },
            scrollTrigger: { trigger: root.current, start: START, once: true },
          })
          .from(lines, { opacity: 0, y: 14, stagger: STAGGER })
          // The section's one loud moment: the artwork rises out of its own
          // frame. The figure already clips, so a transform reads as a wipe
          // without animating clip-path or any box property.
          .from(art.current, { opacity: 0, yPercent: 8, duration: 0.7, ease: "power2.out" }, "<0.15")
          .from(cta.current, { opacity: 0, y: 12 }, "<0.35");
      }),
    { scope: root },
  );

  return (
    <section
      ref={root}
      id={ANCHORS.workforce}
      aria-labelledby="ai-workforce-title"
      className="scroll-mt-16 bg-surface py-20 sm:scroll-mt-18 sm:py-28"
    >
      <Container>
        <div ref={intro} className="mx-auto max-w-3xl text-center">
          <Eyebrow className="text-brand-accent">{t("landing.workforce.badge")}</Eyebrow>
          <SectionTitle className="mx-auto">
            <span id="ai-workforce-title">{t("landing.workforce.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm text-pretty text-muted-foreground">{t("landing.workforce.sub")}</p>
        </div>

        <figure className="group relative mx-auto mt-14 aspect-[16/9] max-w-5xl overflow-hidden rounded-lg border border-border bg-background">
          <Image
            ref={art}
            src={artwork("ai-workforce")}
            alt={t("landing.workforce.imageAlt")}
            fill
            sizes="(min-width: 1024px) 64rem, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.01] motion-reduce:transition-none"
          />
        </figure>

        <div ref={cta} className="mt-10 flex justify-center">
          <Link
            href={paths.register()}
            className={cn(buttonVariants({ variant: "brand", size: "lg" }), "h-12 px-7 text-body-lg")}
          >
            {t("landing.workforce.cta")}
            <ArrowRight />
          </Link>
        </div>
      </Container>
    </section>
  );
}
