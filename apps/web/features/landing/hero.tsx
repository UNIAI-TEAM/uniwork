"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Container } from "./layout-primitives";

export function Hero() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="landing-title" className="landing-hero">
      <Container className="landing-hero-container">
        <div className="landing-hero-stage">
          <div className="landing-hero-copy">
            <h1 id="landing-title">
              <span className="landing-hero-line">{t("landing.studio.heroLine1")}</span>
              <span className="landing-hero-line">
                {t("landing.studio.heroLine2")}
              </span>
            </h1>
            <p className="landing-hero-description">{t("landing.studio.heroDescription")}</p>
            <div className="landing-hero-actions">
              <Link href={paths.register()} className={cn(buttonVariants({ variant: "brand", size: "lg" }), "landing-action")}>
                {t("landing.cta.start")}<ArrowRight aria-hidden />
              </Link>
              <Link href={paths.requestDemo()} className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "landing-demo-action")}>
                {t("landing.demo.cta")}
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
