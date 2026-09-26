"use client";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, BrainCircuit, CircleHelp, Database, Eye, KeyRound, Layers3, LifeBuoy, MessageCircleQuestion, PlugZap, ShieldAlert } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@uniwork/ui/components/ui/accordion";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, Eyebrow, SectionTitle } from "./layout-primitives";
import { Button } from "@uniwork/ui/components/ui/button";
import { Logo } from "@uniwork/ui/brand";

const FAQ_ICONS = [Layers3, ShieldAlert, Eye, Database, BrainCircuit, KeyRound, LifeBuoy, PlugZap, Bot, CircleHelp] as const;

export interface FaqProps {
  /** i18n prefix holding `q1`/`a1` … pairs. */
  namespace: string;
  /** How many pairs the namespace has. */
  count: number;
  title: string;
  eyebrow?: string;
  className?: string;
  initialCount?: number;
}

/**
 * One component for the landing page's six questions and the three on each
 * solution page, so a department's FAQ cannot drift into a different shape.
 * The registry accordion carries the keyboard and aria behaviour; nothing here
 * reimplements a disclosure.
 */
export function Faq({ namespace, count, title, eyebrow, className, initialCount = count }: FaqProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const parts = body.current ? Array.from(body.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(parts, { clearProps: "all" });
          return;
        }
        revealFrom(parts, root.current, 0.08);
      }),
    { scope: root },
  );

  const questions = Array.from({ length: count }, (_, i) => i + 1);
  // The namespace is an i18n key; dots are legal in an id but read badly in the
  // DOM and in a test selector.
  const domId = `${namespace.replace(/\./g, "-")}-title`;
  const isLanding = className?.split(" ").includes("landing-faq") ?? false;
  const intro = <>
    <div className="faq-heading-mark" aria-hidden><MessageCircleQuestion /></div>
    {eyebrow ? <Eyebrow className="text-brand">{t(eyebrow)}</Eyebrow> : null}
    <SectionTitle className={eyebrow ? undefined : "mt-0"}><span id={domId}>{t(title)}</span></SectionTitle>
  </>;

  return (
    <section ref={root} aria-labelledby={domId} className={className ?? "bg-surface py-20 sm:py-28"}>
      <Container ref={body} className={isLanding ? "faq-layout" : "max-w-3xl"}>
        {isLanding ? <div className="faq-story">{intro}<p>{t("landing.studio.faqSub")}</p><div className="faq-story-art" aria-hidden><svg className="faq-story-wiring" viewBox="0 0 520 300" preserveAspectRatio="none" fill="none"><path d="M260 142C188 108 129 94 66 100" /><path d="M260 142C338 99 393 86 459 112" /><path d="M260 142C225 208 168 238 109 255" /></svg><span className="faq-story-mark"><Logo variant="mark" size={44} decorative /></span><span className="faq-story-topic faq-story-topic-one"><Layers3 />{t("landing.studio.tasksTab")}</span><span className="faq-story-topic faq-story-topic-two"><BrainCircuit />{t("landing.studio.askTab")}</span><span className="faq-story-topic faq-story-topic-three"><Database />{t("landing.studio.knowledge")}</span></div></div> : intro}
        <div className={isLanding ? "faq-questions" : undefined}>
        <Accordion className="mt-10">
          {questions.slice(0, initialCount).map((n) => {
            const Icon = FAQ_ICONS[(n - 1) % FAQ_ICONS.length] ?? CircleHelp;
            return (
            <AccordionItem key={n} value={`${namespace}-${n}`} className="border-border">
              <AccordionTrigger className="py-5 text-title-sm font-semibold">
                <span className="faq-question-label"><span className="faq-question-icon" aria-hidden><Icon /></span><span>{t(`${namespace}.q${n}`)}</span></span>
              </AccordionTrigger>
              <AccordionContent>
                <p className="max-w-prose pb-2 text-body-lg leading-relaxed text-muted-foreground">
                  {t(`${namespace}.a${n}`)}
                </p>
              </AccordionContent>
            </AccordionItem>
            );
          })}
        </Accordion>
        {initialCount < count && <>
          <div id={`${domId}-more`} hidden={!expanded}>
            <Accordion>{questions.slice(initialCount).map((n) => { const Icon = FAQ_ICONS[(n - 1) % FAQ_ICONS.length] ?? CircleHelp; return <AccordionItem key={n} value={`${namespace}-${n}`} className="border-border">
              <AccordionTrigger className="py-5 text-title-sm font-semibold"><span className="faq-question-label"><span className="faq-question-icon" aria-hidden><Icon /></span><span>{t(`${namespace}.q${n}`)}</span></span></AccordionTrigger>
              <AccordionContent><p className="max-w-prose pb-2 text-body-lg leading-relaxed text-muted-foreground">{t(`${namespace}.a${n}`)}</p></AccordionContent>
            </AccordionItem>; })}</Accordion>
          </div>
          <Button variant="outline" className="faq-more" aria-expanded={expanded} aria-controls={`${domId}-more`} onClick={() => setExpanded((value) => !value)}>{t(expanded ? "landing.explorer.fewerQuestions" : "landing.explorer.moreQuestions")}</Button>
        </>}
        </div>
      </Container>
    </section>
  );
}
