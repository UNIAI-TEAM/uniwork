"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { landingFont } from "../../platform/landing-font";
import { ANCHORS } from "./anchors";
import { TaskPoster } from "./product-playback";
import "./landing.css";
import "./landing-closing.css";

/**
 * User-pinned ClickUp closing composition, within the existing UniWork identity:
 * centered brand, one invitation and registration action, then the real sample UI.
 * The blue/violet field replaces the narrow navy strip; no native-mobile claim,
 * new offer or second sandbox. The illustration is static and labelled as sample data.
 */
export function FinalCta() {
  const { t } = useTranslation();
  return (
    <section id={ANCHORS.contact} className={`landing-site ${landingFont.variable} final-section final-showcase-section`}>
      <div className="final-layout">
        <div className="final-brand"><Logo variant="mark" size={48} /></div>
        <h2 className="studio-title">{t("landing.studio.finalTitle")}</h2>
        <div className="final-actions">
          <Link href={paths.register()} className={cn(buttonVariants({ variant: "brand", size: "lg" }), "studio-button")}>
            {t("landing.final.primary")}<ArrowRight aria-hidden />
          </Link>
        </div>
      </div>
      <figure className="final-showcase">
        <figcaption>{t("landing.lovable.sample")}</figcaption>
        <div className="final-product-window"><TaskPoster /></div>
      </figure>
    </section>
  );
}
