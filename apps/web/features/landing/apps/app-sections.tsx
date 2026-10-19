"use client";
import { ArrowRight, Download } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingAnchor, MarketingLink as Link } from "../../../platform/marketing-link";
import { Container } from "../layout-primitives";
import { AppIcon } from "./app-icon";
import { APP_CATALOG, type AppKey } from "./catalog";

/** A section label drawn like the chat's day separator ("Hôm nay"): the pages' recurring mark. */
export function AppPill({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("app-pill", className)}>{children}</p>;
}

/** The other apps of the ecosystem, at the foot of an app page. */
export function OtherApps({ current }: { current: AppKey }) {
  const { t } = useTranslation();
  return <section className="app-section" aria-labelledby="other-apps-title">
    <Container>
      <div className="app-other">
        <div className="app-other-head">
          <div><AppPill>{t("landing.apps.other.eyebrow")}</AppPill><h2 id="other-apps-title">{t("landing.apps.other.title")}</h2></div>
          <Link className="app-link" href={paths.apps.root()}>{t("landing.apps.other.all")}<ArrowRight aria-hidden /></Link>
        </div>
        <ul className="app-other-list">
          {APP_CATALOG.filter((app) => app.key !== current).map((app) => <li key={app.key}>
            <Link className="app-other-card" href={app.href}>
              <AppIcon app={app.key} size={40} />
              <span><strong>{t(`landing.apps.catalog.${app.key}.name`)}</strong><small>{t(`landing.apps.catalog.${app.key}.strip`)}</small></span>
              <ArrowRight aria-hidden />
            </Link>
          </li>)}
        </ul>
      </div>
    </Container>
  </section>;
}

/** Two columns: the label and title beside the questions, the first one open. */
export function AppFaq({ id, namespace, count, eyebrow, title, aside }: { id: string; namespace: string; count: number; eyebrow: string; title: string; aside?: ReactNode }) {
  const { t } = useTranslation();
  const questions = Array.from({ length: count }, (_, i) => i + 1);
  return <section id={id} className="app-section app-faq" aria-labelledby={`${id}-title`}>
    <Container className="app-faq-grid">
      <div className="app-faq-head"><AppPill>{eyebrow}</AppPill><h2 id={`${id}-title`}>{title}</h2>{aside}</div>
      <Accordion className="app-faq-list" defaultValue={[`${namespace}-1`]}>
        {questions.map((n) => <AccordionItem key={n} value={`${namespace}-${n}`}>
          <AccordionTrigger className="app-faq-q">{t(`${namespace}.q${n}`)}</AccordionTrigger>
          <AccordionContent><p className="app-faq-a">{t(`${namespace}.a${n}`)}</p></AccordionContent>
        </AccordionItem>)}
      </Accordion>
    </Container>
  </section>;
}

/** The pages' closing line: the second half sits in the product's own message bubble. */
export function AppClosing({ line1, line2, primary, secondary }: { line1: string; line2: string; primary: { href: string; label: string; download?: boolean }; secondary: { href: string; label: string } }) {
  const Primary = primary.href.startsWith("#") ? MarketingAnchor : Link;
  const Secondary = secondary.href.startsWith("#") ? MarketingAnchor : Link;
  return <section className="app-closing" aria-labelledby="app-closing-title">
    <Container className="app-closing-inner">
      <h2 id="app-closing-title">{line1} <span className="app-bubble is-closing">{line2}</span></h2>
      <div className="app-actions">
        <Primary className={cn(buttonVariants({ variant: "brand", size: "lg" }))} href={primary.href}>{primary.download && <Download aria-hidden />}{primary.label}</Primary>
        <Secondary className={cn(buttonVariants({ variant: "outline", size: "lg" }))} href={secondary.href}>{secondary.label}</Secondary>
      </div>
    </Container>
  </section>;
}
