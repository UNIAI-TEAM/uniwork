"use client";
import { FileCheck2, FileStack, Network, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";
import { ANCHORS } from "./anchors";

const VALUES = [Network, Sparkles, FileCheck2, FileStack] as const;

/** Product vision belongs inside the roadmap, not among shipped features. */
export function WorkProducts() {
  const { t } = useTranslation();
  return <AccordionItem id={ANCHORS.workProducts} value="work-products">
    <AccordionTrigger><span className="roadmap-phase-name"><FileStack className="size-6 text-brand" aria-hidden /><span>{t("landing.discovery.workProducts")}<small>{t("landing.studio.workProductsNote")}</small></span></span></AccordionTrigger>
    <AccordionContent>
      <ul className="planned-products">{VALUES.map((Icon, i) => <li key={i}>
        <span className="work-product-icon" aria-hidden><Icon /></span>
        <div><h3>{t(`landing.workProducts.v${i + 1}Title`)}</h3><p>{t(`landing.workProducts.v${i + 1}Desc`)}</p></div>
      </li>)}</ul>
      <p className="work-products-note">{t("landing.workProducts.timelineNote")}</p>
    </AccordionContent>
  </AccordionItem>;
}
