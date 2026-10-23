"use client";
import { useTranslation } from "react-i18next";
import { MARKETING_GUIDE_KEYS, paths } from "@uniwork/core/paths";
import { MarketingLink as Link } from "../../platform/marketing-link";
import { useMarketingLocale } from "../../platform/marketing-context";
import { seoCopy } from "../../platform/seo-copy";

export function GuideDirectory() {
  const { t } = useTranslation();
  const locale = useMarketingLocale();
  return <section className="chapter-width chapter-section" id="practical-guides" aria-labelledby="practical-guides-title">
    <h2 id="practical-guides-title" className="text-title-lg font-semibold">{t("marketingSeo.guidesTitle")}</h2>
    <ul className="mt-6 divide-y divide-border">{MARKETING_GUIDE_KEYS.map(key => { const copy = seoCopy(key, locale); return <li key={key} className="py-6"><Link href={paths.guide(key)} className="text-title-sm font-semibold text-brand hover:underline">{copy.title}</Link><p className="mt-2 max-w-prose text-body-lg leading-relaxed text-muted-foreground">{copy.description}</p></li>; })}</ul>
  </section>;
}
