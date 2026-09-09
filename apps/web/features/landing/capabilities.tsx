"use client";
import { Bot, Building2, Mail, MessageSquare, SquareKanban, Video } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ANCHORS } from "./anchors";
import { gsap, ScrollTrigger, useGSAP } from "./animation/register-gsap";
import { DURATION, EASE, RISE, START, withMotionPreference } from "./animation/reveal";
import { Container, Eyebrow, SectionTitle } from "./layout-primitives";

/**
 * Every cell here must name something the product does today. `soon` is the
 * only honest way to keep a roadmap item on the page: it is a promise, and it
 * has to read as one. Two cells were removed rather than labelled — a
 * knowledge base and a workflow engine have no code behind them at all, so
 * even "coming soon" would be inventing a plan.
 */
const CAPABILITIES = [
  { icon: SquareKanban, title: "landing.platform.tasksTitle", desc: "landing.platform.tasksDesc" },
  { icon: Video, title: "landing.platform.meetTitle", desc: "landing.platform.meetDesc" },
  { icon: MessageSquare, title: "landing.platform.chatTitle", desc: "landing.platform.chatDesc" },
  { icon: Bot, title: "landing.platform.aiTitle", desc: "landing.platform.aiDesc" },
  { icon: Building2, title: "landing.platform.workspaceTitle", desc: "landing.platform.workspaceDesc" },
  { icon: Mail, title: "landing.platform.emailTitle", desc: "landing.platform.emailDesc", soon: true },
] as const;

/**
 * The 1px rules between cells are the grid's own `gap-px` showing the --border
 * ground through, so the lines stay hairline at any zoom and no cell carries a
 * border that would double up against its neighbour.
 */
export function Capabilities() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const grid = useRef<HTMLUListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = grid.current ? Array.from(grid.current.children) : [];
        if (!motion) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        // batch() rather than one trigger per cell: on a wide viewport the whole
        // grid crosses the fold together, and batching is what turns six
        // simultaneous callbacks into one staggered group instead of six
        // animations racing.
        gsap.set(cells, { opacity: 0, y: RISE });
        ScrollTrigger.batch(cells, {
          start: START,
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, {
              opacity: 1,
              y: 0,
              duration: DURATION,
              ease: EASE,
              stagger: { each: 0.05, grid: "auto", from: "start" },
              overwrite: true,
            }),
        });
      }),
    { scope: root },
  );

  return (
    <section
      ref={root}
      id={ANCHORS.platform}
      className="scroll-mt-16 border-y border-border bg-background py-20 sm:scroll-mt-18 sm:py-28"
    >
      <Container>
        <div className="max-w-3xl">
          <Eyebrow className="text-brand">{t("landing.platform.eyebrow")}</Eyebrow>
          <SectionTitle>{t("landing.platform.title")}</SectionTitle>
          <p className="mt-4 text-title-sm text-muted-foreground">{t("landing.platform.sub")}</p>
        </div>

        <ul className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <li key={item.title} className="group bg-surface p-6 sm:p-8">
              <item.icon className="size-6 text-brand transition-transform duration-200 group-hover:translate-x-1" />
              <h3 className="mt-8 flex flex-wrap items-center gap-2 font-heading text-title font-bold">
                {t(item.title)}
                {"soon" in item && item.soon ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-caption font-medium text-muted-foreground">
                    {t("landing.platform.soon")}
                  </span>
                ) : null}
              </h3>
              <p className="mt-2 text-body leading-relaxed text-muted-foreground">{t(item.desc)}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
