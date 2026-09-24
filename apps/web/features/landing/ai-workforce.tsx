"use client";
import { ArrowRight, BookOpen, ScanText, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";
import { ANCHORS } from "./anchors";
import { Container } from "./layout-primitives";
import { HorseMascot } from "./horse-mascot";

const BENEFITS = [{ key: "ask", icon: ScanText }, { key: "ai-brain", icon: BookOpen }, { key: "agents", icon: ShieldCheck }] as const;

export function AiWorkforce() {
  const { t } = useTranslation();
  return (
    <section id={ANCHORS.workforce} className="studio-section ai-section" aria-labelledby="ai-title">
      <Container>
        <div className="ai-stage" data-landing-stage="mascot">
          <div className="ai-stage-copy">
          <div className="ai-intro">
            <h2 id="ai-title" className="studio-title">{t("landing.revision.ai.title")}</h2>
            <p className="studio-description">{t("landing.revision.ai.description")}</p>
          </div>
            <Accordion className="ai-benefits">
              {BENEFITS.map(({ key, icon: Icon }, index) => <AccordionItem key={key} value={key}>
                <AccordionTrigger><span><Icon aria-hidden />{t(`landing.revision.ai.layers.${index}.title`)}</span></AccordionTrigger>
                <AccordionContent><p>{t(`landing.revision.ai.layers.${index}.description`)}</p><Link className="revision-text-link" href={paths.feature(key)}>{t("landing.productPages.learnCta")}<ArrowRight aria-hidden /></Link></AccordionContent>
              </AccordionItem>)}
            </Accordion>
            <Link href={paths.feature("ai-brain")} className={cn(buttonVariants({ variant: "brand", size: "lg" }), "studio-button ai-demo-link")}>{t("landing.revision.ai.cta")}<ArrowRight aria-hidden /></Link>
          </div>
          <figure className="ai-visual">
            <HorseMascot />
            <figcaption className="sr-only">{t("landing.motion.characterLabel")}</figcaption>
          </figure>
        </div>
      </Container>
    </section>
  );
}
