"use client";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";

/**
 * Two links, not a sign-in form. The source page called the auth SDK straight
 * from the component; in this codebase only api/endpoints may touch the
 * transport, and the login screen already exists and handles MFA, Google and
 * the post-auth destination.
 */
export function FinalCta() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const columns = useRef<HTMLDivElement>(null);

  // Deliberately plain. This is where someone decides to sign up; a flourish
  // here delays the only control that matters.
  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const items = columns.current ? Array.from(columns.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(items, { clearProps: "all" });
          return;
        }
        revealFrom(items, root.current, 0.08);
      }),
    { scope: root },
  );

  return (
    <section
      ref={root}
      id={ANCHORS.contact}
      className="scroll-mt-16 border-t border-border bg-background py-20 sm:scroll-mt-18 sm:py-28"
    >
      <Container ref={columns} className="grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div>
          <ShieldCheck className="size-9 text-brand" />
          <SectionTitle className="mt-5">{t("landing.final.title")}</SectionTitle>
          <p className="mt-4 text-title-sm leading-relaxed text-muted-foreground">{t("landing.final.sub")}</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-[var(--floating-shadow)] sm:p-8">
          <p className="text-body text-muted-foreground">{t("landing.hero.sub")}</p>
          <div className="mt-6 grid gap-3">
            <Link
              href={paths.register()}
              className={cn(buttonVariants({ variant: "brand", size: "lg" }), "h-12 text-body-lg")}
            >
              {t("landing.final.primary")}
            </Link>
            <Link
              href={paths.login()}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 text-body-lg")}
            >
              {t("landing.final.secondary")}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
