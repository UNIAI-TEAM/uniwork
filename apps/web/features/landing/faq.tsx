"use client";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@uniwork/ui/components/ui/accordion";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, Eyebrow, SectionTitle } from "./layout-primitives";

export interface FaqProps {
  /** i18n prefix holding `q1`/`a1` … pairs. */
  namespace: string;
  /** How many pairs the namespace has. */
  count: number;
  title: string;
  eyebrow?: string;
  className?: string;
}

/**
 * One component for the landing page's six questions and the three on each
 * solution page, so a department's FAQ cannot drift into a different shape.
 * The registry accordion carries the keyboard and aria behaviour; nothing here
 * reimplements a disclosure.
 */
export function Faq({ namespace, count, title, eyebrow, className }: FaqProps) {
  const { t } = useTranslation();
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

  return (
    <section ref={root} aria-labelledby={domId} className={className ?? "bg-surface py-20 sm:py-28"}>
      <Container ref={body} className="max-w-3xl">
        {eyebrow ? <Eyebrow className="text-brand">{t(eyebrow)}</Eyebrow> : null}
        <SectionTitle className={eyebrow ? undefined : "mt-0"}>
          <span id={domId}>{t(title)}</span>
        </SectionTitle>

        <Accordion className="mt-10">
          {questions.map((n) => (
            <AccordionItem key={n} value={`${namespace}-${n}`} className="border-border">
              <AccordionTrigger className="py-5 text-title-sm font-semibold">
                {t(`${namespace}.q${n}`)}
              </AccordionTrigger>
              <AccordionContent>
                <p className="max-w-prose pb-2 text-body-lg leading-relaxed text-muted-foreground">
                  {t(`${namespace}.a${n}`)}
                </p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Container>
    </section>
  );
}
