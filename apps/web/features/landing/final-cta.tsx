"use client";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { landingFont } from "../../platform/landing-font";
import { ANCHORS, href } from "./anchors";
import { TaskPoster } from "./product-playback";
import "./landing.css";
import "./landing-closing.css";

/** A product chapter closes in the same visual rhythm as its examples and related features. */
export function FinalCta({
  compact = false,
  titleKey = "landing.final.compactTitle",
  demoHref = href(ANCHORS.platform),
}: { compact?: boolean; titleKey?: string; demoHref?: string }) {
  const { t } = useTranslation();
  if (compact) {
    return (
      <section id={ANCHORS.contact} aria-labelledby="final-title" className="final-section final-compact-section">
        <div className="final-compact-copy">
          <div className="final-chapter-mark" aria-hidden="true"><Logo variant="mark" size={44} /></div>
          <h2 id="final-title">{t(titleKey)}</h2>
          <p>{t("landing.studio.finalSub")}</p>
        </div>
        <div className="final-compact-actions">
          <Link href={paths.register()} className={cn(buttonVariants({ variant: "brand", size: "lg" }), "final-compact-primary")}>
            {t("landing.final.primary")}<ArrowRight aria-hidden />
          </Link>
          <Link href={demoHref} className="final-compact-demo">
            <Play aria-hidden />{t("landing.productPages.watchDemo")}
          </Link>
        </div>
      </section>
    );
  }
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
