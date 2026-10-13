"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Container } from "./layout-primitives";
import { InteractiveScene } from "./interactive-scene";

export function Hero() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="landing-title" className="landing-hero">
      <Container>
        <div className="landing-hero-stage">
        <div className="landing-hero-copy">
          <h1 id="landing-title">
            {t("landing.studio.heroLine1")}{" "}
            <span>{t("landing.studio.heroLine2")}</span>
          </h1>
          <p className="landing-hero-description">{t("landing.studio.heroDescription")}</p>
          <div className="landing-hero-actions">
            <Link href={paths.register()} className={cn(buttonVariants({ variant: "brand", size: "lg" }), "landing-action")}>
              {t("landing.cta.start")}<ArrowRight aria-hidden />
            </Link>
          </div>
        </div>
        <InteractiveScene />
        </div>
      </Container>
    </section>
  );
}
