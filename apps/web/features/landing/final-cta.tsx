"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, EmphasisSection, SectionTitle } from "./layout-primitives";

/**
 * Two links, not a sign-in form. The source page called the auth SDK straight
 * from the component; in this codebase only api/endpoints may touch the
 * transport, and the login screen already exists and handles MFA, Google and
 * the post-auth destination.
 *
 * Stacked on the emphasis plane rather than split into copy beside a bordered
 * card. The card repeated the hero's subhead word for word, which meant the
 * last thing a visitor read before deciding was a sentence they had already
 * read at the top; and a fourth two-column split would have been the page's
 * fourth. The polarity flip is what marks this as the end of the argument, so
 * nothing else in the composition has to work to be noticed.
 */
export function FinalCta() {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);

  // Deliberately plain. This is where someone decides to sign up; a flourish
  // here delays the only control that matters.
  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const items = root.current ? Array.from(root.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(items, { clearProps: "all" });
          return;
        }
        revealFrom(items, root.current, 0.08);
      }),
    { scope: root },
  );

  return (
    <EmphasisSection id={ANCHORS.contact} className="scroll-mt-16 sm:scroll-mt-18">
      <Container ref={root} className="max-w-4xl py-24 sm:py-32">
        <SectionTitle className="mt-0">{t("landing.final.title")}</SectionTitle>
        <p className="mt-5 max-w-2xl text-title-sm leading-relaxed text-muted-foreground">
          {t("landing.final.sub")}
        </p>
        <div className="mt-9 grid gap-3 min-[390px]:grid-cols-2 sm:flex sm:flex-wrap sm:gap-4">
          <Link
            href={paths.register()}
            className={cn(buttonVariants({ variant: "brand", size: "lg" }), "h-12 px-6 text-body-lg sm:px-7")}
          >
            {t("landing.final.primary")}
            <ArrowRight />
          </Link>
          <Link
            href={paths.login()}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 px-6 text-body-lg sm:px-7")}
          >
            {t("landing.final.secondary")}
          </Link>
        </div>
      </Container>
    </EmphasisSection>
  );
}
