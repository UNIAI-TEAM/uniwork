"use client";
import { ArrowRight, BookOpen, ScanText, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";
import { ANCHORS } from "./anchors";
import { Container } from "./layout-primitives";
import { HorseMascot } from "./horse-mascot";

const BENEFITS = [{ key: "aiRead", icon: ScanText }, { key: "aiSource", icon: BookOpen }, { key: "aiControl", icon: ShieldCheck }] as const;

export function AiWorkforce() {
  const { t } = useTranslation();
  return (
    <section id={ANCHORS.workforce} className="studio-section ai-section" aria-labelledby="ai-title">
      <Container>
        <div className="ai-stage" data-landing-stage="mascot">
          <div className="ai-stage-copy">
          <div className="ai-intro">
            <h2 id="ai-title" className="studio-title">{t("landing.studio.aiTitle")}</h2>
            <p className="studio-description">{t("landing.studio.aiSub")}</p>
          </div>
            <Accordion className="ai-benefits">
              {BENEFITS.map(({ key, icon: Icon }) => <AccordionItem key={key} value={key}>
                <AccordionTrigger><span><Icon aria-hidden />{t(`landing.studio.${key}`)}</span></AccordionTrigger>
                <AccordionContent><p>{t(`landing.studio.${key}Desc`)}</p>{key === "aiRead" && <p>{t("landing.askuni.point3")}</p>}</AccordionContent>
              </AccordionItem>)}
            </Accordion>
            <a href="#hoi-uni" className={cn(buttonVariants({ variant: "brand", size: "lg" }), "studio-button ai-demo-link")}>{t("landing.reference.viewAsk")}<ArrowRight aria-hidden /></a>
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
