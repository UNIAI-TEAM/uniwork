"use client";
import { Cpu, MapPin, ScrollText, Undo2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Container } from "./layout-primitives";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";

/**
 * The three model names are written as plain text, not brand marks: UniWork
 * calls these providers (server/internal/ai/provider/) but has no licence to
 * redraw their logos, and a wordmark nobody owns cannot go stale.
 */
const MODELS = ["Anthropic", "OpenAI", "landing.trust.modelSelfHosted"] as const;

/**
 * Every claim here is one a test in this repo already holds: the append-only
 * log (TestAuditEventsAreAppendOnly), the proposal → confirm → execute path
 * for agents (ADR 0010), and the deployment's data residency. Nothing goes in
 * this band that a reviewer cannot follow to a test or a contract.
 */
const GUARANTEES = [
  { icon: MapPin, title: "landing.trust.dataTitle", desc: "landing.trust.dataDesc" },
  { icon: ScrollText, title: "landing.trust.auditTitle", desc: "landing.trust.auditDesc" },
  { icon: Undo2, title: "landing.trust.undoTitle", desc: "landing.trust.undoDesc" },
] as const;

export function TrustBand() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const items = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = items.current ? Array.from(items.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        revealFrom(cells, root.current, 0.06);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-label={t("landing.trust.modelsLabel")} className="border-y border-border bg-surface">
      <Container className="py-10 sm:py-12">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="inline-flex items-center gap-2 text-body font-medium text-muted-foreground">
            <Cpu className="size-4 text-brand" />
            {t("landing.trust.modelsLabel")}
          </span>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {MODELS.map((name) => (
              <li key={name} className="text-body-lg font-semibold">
                {name.startsWith("landing.") ? t(name) : name}
              </li>
            ))}
          </ul>
        </div>

        <div ref={items} className="mt-8 grid gap-6 sm:grid-cols-3 sm:gap-8">
          {GUARANTEES.map((item) => (
            <div key={item.title} className="flex gap-3">
              <item.icon className="mt-0.5 size-5 shrink-0 text-brand" />
              <div>
                <h2 className="text-body font-semibold">{t(item.title)}</h2>
                <p className="mt-1 text-body leading-relaxed text-muted-foreground">{t(item.desc)}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
