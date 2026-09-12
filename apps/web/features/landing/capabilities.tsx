"use client";
import {
  Bell,
  Bot,
  Building2,
  Gauge,
  Mail,
  MessageSquare,
  ScrollText,
  Search,
  SquareKanban,
  UsersRound,
  Video,
  Wrench,
} from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
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
 *
 * `span` and `tint` are composition, not hierarchy. Six equal boxes of
 * icon-and-paragraph is the shape every generated feature grid takes, and it
 * flattens six different things into one texture; the two cells that get a
 * whole row and a lifted ground are the two a visitor has the least prior idea
 * about.
 *
 * No photographs in here. Every picture this page owns is already carrying a
 * section of its own further down, and a grid that repeats them turns the
 * bands below into a rerun. The variation is tonal instead, and the two
 * lifted cells are lifted differently: the AI cell takes a 5% wash of the
 * brand hue, the Email cell takes `--muted`. Both grounds are derived from
 * tokens that already exist in each theme, and both carry the same
 * `--muted-foreground` body copy that the plain cells do, so
 * e2e/landing.spec.ts measures them the same way it measures everything else.
 */
const CAPABILITIES = [
  {
    icon: Bot,
    title: "landing.platform.aiTitle",
    desc: "landing.platform.aiDesc",
    span: "lg:col-span-4",
    tint: "bg-brand/5",
    ink: "text-brand",
  },
  { icon: SquareKanban, title: "landing.platform.tasksTitle", desc: "landing.platform.tasksDesc", span: "lg:col-span-2", ink: "text-brand" },
  { icon: Video, title: "landing.platform.meetTitle", desc: "landing.platform.meetDesc", span: "lg:col-span-2", ink: "text-brand-accent" },
  {
    icon: MessageSquare,
    title: "landing.platform.chatTitle",
    desc: "landing.platform.chatDesc",
    span: "lg:col-span-4",
    tint: "bg-brand-accent/5",
    ink: "text-brand-accent",
  },
  { icon: Search, title: "landing.platform.searchTitle", desc: "landing.platform.searchDesc", span: "lg:col-span-2", ink: "text-info" },
  { icon: Bell, title: "landing.platform.notifyTitle", desc: "landing.platform.notifyDesc", span: "lg:col-span-2", ink: "text-warning" },
  { icon: UsersRound, title: "landing.platform.peopleTitle", desc: "landing.platform.peopleDesc", span: "lg:col-span-2", ink: "text-chart-2" },
  { icon: Building2, title: "landing.platform.workspaceTitle", desc: "landing.platform.workspaceDesc", span: "lg:col-span-3", ink: "text-brand" },
  {
    icon: ScrollText,
    title: "landing.platform.auditTitle",
    desc: "landing.platform.auditDesc",
    span: "lg:col-span-3",
    tint: "bg-muted",
    ink: "text-success",
  },
  { icon: Wrench, title: "landing.platform.agentsTitle", desc: "landing.platform.agentsDesc", span: "lg:col-span-2", ink: "text-brand" },
  { icon: Gauge, title: "landing.platform.plansTitle", desc: "landing.platform.plansDesc", span: "lg:col-span-4", ink: "text-info" },
  {
    icon: Mail,
    title: "landing.platform.emailTitle",
    desc: "landing.platform.emailDesc",
    soon: true,
    span: "lg:col-span-6",
    tint: "bg-muted",
    ink: "text-muted-foreground",
  },
] as const;

/**
 * The 1px rules between cells are the grid's own `gap-px` showing the --border
 * ground through, so the lines stay hairline at any zoom and no cell carries a
 * border that would double up against its neighbour.
 *
 * Spans total 6 on every row (4+2, 2+4, 2+2+2, 3+3, 2+4, 6), so the grid closes
 * with no cell left holding a gap and the wide cell changes sides from row to
 * row rather than stacking down one edge.
 *
 * `ink` colours the glyph, never the copy. The signal palette is text-safe on
 * a light surface but was not measured on its own tint, and 1.4.11 asks 3:1 of
 * a non-text mark where text is held to 4.5:1. Keeping every string on
 * --foreground or --muted-foreground is what lets the grid carry six hues and
 * still pass e2e/landing.spec.ts in both themes.
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
          <p className="mt-4 max-w-prose text-title-sm text-pretty text-muted-foreground">{t("landing.platform.sub")}</p>
        </div>

        <ul className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-6">
          {CAPABILITIES.map((item) => (
            <li
              key={item.title}
              className={cn("group p-6 sm:p-8", item.span, "tint" in item ? item.tint : "bg-surface")}
            >
              <item.icon
                className={cn(
                  "size-6 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none",
                  item.ink,
                )}
              />
              <h3 className="mt-8 flex flex-wrap items-center gap-2 font-heading text-title font-bold">
                {t(item.title)}
                {"soon" in item && item.soon ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-caption font-medium text-muted-foreground">
                    {t("landing.platform.soon")}
                  </span>
                ) : null}
              </h3>
              <p className="mt-2 max-w-prose text-body-lg leading-relaxed text-muted-foreground">{t(item.desc)}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
