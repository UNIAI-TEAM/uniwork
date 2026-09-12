"use client";
import { Cpu, MapPin, ScrollText, Undo2, UserRoundCheck } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Container } from "./layout-primitives";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { PROVIDER_MARKS, type ProviderMarkKey } from "./provider-marks.generated";

/**
 * The three providers UniWork actually calls (server/internal/ai/provider/).
 *
 * These were set as plain text, on the reasoning that a mark nobody owns
 * cannot go stale. Set type turned out to be the weaker claim: two of the
 * three are wordmarks a Vietnamese reader has no reason to read as software,
 * and the one row on this page that names real infrastructure was the row that
 * looked like it named nothing.
 *
 * The artwork is vendored verbatim, never redrawn — see
 * scripts/landing/build-provider-marks.mjs for where it comes from, what the
 * licence covers and what it does not. Ollama keeps a qualifier because
 * "self-hosted" is the difference between it and the two hosted APIs beside
 * it, not a category label under a logo.
 */
const MODELS = [
  { mark: "anthropic", label: "Anthropic" },
  { mark: "openai", label: "OpenAI" },
  { mark: "ollama", label: "landing.trust.modelSelfHosted" },
] as const satisfies readonly { mark: ProviderMarkKey; label: string }[];

/**
 * Every claim here is one a test in this repo already holds: the append-only
 * log (TestAuditEventsAreAppendOnly), the proposal → confirm → execute path
 * for agents (ADR 0010), and the deployment's data residency. Nothing goes in
 * this band that a reviewer cannot follow to a test or a contract.
 *
 * Four, not three. The first arrived from the hero, where it was four words
 * behind a check mark and had to be taken on faith; here it gets the sentence
 * that makes it checkable. The hero's other two claims were dropped: one
 * repeated `undoTitle` below, and one said Vietnamese was the source language
 * and English a translation, which reads the product as Vietnam-only. The
 * positioning is a global product entering the Vietnamese market first, so
 * that claim went with the wording. Language parity is answered in the FAQ,
 * where it can be stated as parity rather than as a hierarchy.
 */
const GUARANTEES = [
  { icon: UserRoundCheck, title: "landing.trust.peerTitle", desc: "landing.trust.peerDesc" },
  { icon: MapPin, title: "landing.trust.dataTitle", desc: "landing.trust.dataDesc" },
  { icon: ScrollText, title: "landing.trust.auditTitle", desc: "landing.trust.auditDesc" },
  { icon: Undo2, title: "landing.trust.undoTitle", desc: "landing.trust.undoDesc" },
] as const;

/**
 * The cells are `h3`. They were `h2`, which put four claims on the same
 * outline level as the page's fourteen section headings — a screen-reader user
 * jumping by heading heard "Data stays in Vietnam" announced as a peer of
 * "Everything the team needs, in one app". The band's own name is on the
 * section's aria-label.
 *
 * Four cells across two rows of a 6-column grid. Two-wide rather than the
 * three-across the problem section and the capability grid below are already
 * built from: this band is read first and its claims are the longest, so they
 * get the wider measure. Four into two columns closes both rows at `sm` and at
 * `lg`, so no cell needs a span override.
 */
const CELL_SPAN = ["lg:col-span-3", "lg:col-span-3", "lg:col-span-3", "lg:col-span-3"] as const;

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
      <Container className="py-12 sm:py-14">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="inline-flex items-center gap-2 text-body font-medium text-muted-foreground">
            <Cpu className="size-4 text-brand" />
            {t("landing.trust.modelsLabel")}
          </span>
          <ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
            {MODELS.map(({ mark, label }) => {
              const art = PROVIDER_MARKS[mark];
              return (
                <li key={mark} className="flex items-center gap-2 text-body-lg font-semibold">
                  {/* aria-hidden and no <title>: the provider's name is the text
                      beside it, and a labelled mark would announce it twice. */}
                  <svg
                    viewBox={art.viewBox}
                    aria-hidden
                    focusable="false"
                    className="size-[1.15em] shrink-0 fill-current"
                  >
                    <path d={art.path} />
                  </svg>
                  {label.startsWith("landing.") ? t(label) : label}
                </li>
              );
            })}
          </ul>
        </div>

        <div
          ref={items}
          className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-6 lg:gap-y-10"
        >
          {GUARANTEES.map((item, i) => (
            <div key={item.title} className={CELL_SPAN[i]}>
              <item.icon className="size-5 text-brand" />
              <h3 className="mt-4 text-body-lg font-semibold">{t(item.title)}</h3>
              <p className="mt-1.5 max-w-prose text-body-lg leading-relaxed text-muted-foreground">{t(item.desc)}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
