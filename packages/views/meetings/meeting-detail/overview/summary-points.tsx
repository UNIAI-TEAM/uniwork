"use client";
import { motion, useReducedMotion } from "motion/react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingEvidenceRef, MeetingSummary } from "@uniwork/core/types/meeting";
import { Drawer, DrawerContent, DrawerTitle } from "@uniwork/ui/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { UI_EASE_OUT } from "@uniwork/ui/lib/motion";
import { useDetail } from "../detail-context";
import { EvidenceBody } from "./evidence-chip";

/** Each word fades in from a 4px blur 4px below, 18ms apart, the whole paragraph within 1.6s (spec F). */
const WORD_S = 0.28;
const WORD_STEP_S = 0.018;
const REVEAL_MAX_S = 1.6;

const words = (text: string) => text.split(/(?<=\s)/);

// 16px, the tint of Thư ký UNI's violet; on a coarse pointer the hit area grows to 44 around it.
const BADGE =
  "relative ml-1 inline-grid size-4 place-items-center rounded-full bg-tint-violet align-[2px] text-micro font-semibold text-tint-violet-foreground transition-[background-color,color,scale] duration-(--duration-fast) ease-out-quart before:absolute before:-inset-3.5 hover:scale-112 hover:bg-tint-violet-solid hover:text-on-solid data-popup-open:bg-tint-violet-solid data-popup-open:text-on-solid pointer-fine:before:hidden";

/**
 * The summary's words: plain text for an older summary read on load; with
 * `summary_points` each sentence carries its numbered source; with `reveal`
 * (a summary that just landed in this session) the words write themselves in.
 */
export function SummaryText({ summary, reveal }: { summary: MeetingSummary; reveal: boolean }) {
  const reduced = useReducedMotion() ?? false;
  const animate = reveal && !reduced;
  const points = summary.summary_points ?? [];
  if (points.length === 0 && !animate) return summary.summary;
  const sentences = points.length > 0 ? points : [{ text: summary.summary, evidence: [] as MeetingEvidenceRef[] }];
  const count = sentences.reduce((n, s) => n + words(s.text).length + 1, 0);
  const step = Math.min(WORD_STEP_S, (REVEAL_MAX_S - WORD_S) / Math.max(count, 1));
  let k = 0;
  const appear = () => ({
    initial: { opacity: 0, filter: "blur(4px)", y: 4 },
    animate: { opacity: 1, filter: "blur(0px)", y: 0 },
    transition: { duration: WORD_S, delay: k++ * step, ease: UI_EASE_OUT },
  });
  return (
    <span data-reveal={animate ? "" : undefined}>
      {sentences.map((point, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          <span
            data-point
            className="rounded-xs box-decoration-clone transition-colors duration-(--duration-standard) has-[[data-popup-open]]:bg-tint-violet has-[[data-source]:focus-visible]:bg-tint-violet has-[[data-source]:hover]:bg-tint-violet"
          >
            {animate
              ? words(point.text).map((word, w) => (
                  <motion.span key={w} className="inline-block whitespace-pre" {...appear()}>
                    {word}
                  </motion.span>
                ))
              : point.text}
            {points.length > 0 && point.evidence.length > 0 ? (
              animate ? (
                <motion.span className="inline-block" {...appear()}>
                  <SourceBadge n={i + 1} refs={point.evidence} />
                </motion.span>
              ) : (
                <SourceBadge n={i + 1} refs={point.evidence} />
              )
            ) : null}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * A sentence's source (clip F): a 16px numbered badge; hover, focus or a tap
 * lights its sentence and opens the cited lines as the evidence popover does
 * (a bottom sheet on a phone).
 */
function SourceBadge({ n, refs }: { n: number; refs: readonly MeetingEvidenceRef[] }) {
  const { t } = useTranslation();
  const { meeting, isPhone } = useDetail();
  const [open, setOpen] = useState(false);
  const label = t("meetings.motion.summary.source", { n });
  const badge = { type: "button" as const, "data-source": "", "aria-label": label, className: BADGE };
  const body = <EvidenceBody meetingId={meeting.id} refs={refs} phone={isPhone} onClose={() => setOpen(false)} />;
  if (isPhone) {
    return (
      <>
        <button {...badge} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          {n}
        </button>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="px-4 pb-8.5 shadow-floating data-[vaul-drawer-direction=bottom]:border-t-0">
            <DrawerTitle className="sr-only">{label}</DrawerTitle>
            {open ? body : null}
          </DrawerContent>
        </Drawer>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger openOnHover delay={150} render={<button {...badge} />}>
        {n}
      </PopoverTrigger>
      <PopoverContent sideOffset={8} aria-label={label} className="w-90 gap-0 border border-border bg-popover p-4 ring-0 dark:shadow-floating">
        {open ? body : null}
      </PopoverContent>
    </Popover>
  );
}
