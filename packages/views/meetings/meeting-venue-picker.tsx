"use client";
import { useId } from "react";
import { Check, UsersRound, Video } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { MEETING_VENUES, type MeetingVenue } from "@uniwork/core/meetings/venue";
import { UI_EASE_OUT, UI_EASE_SETTLE, UI_MOTION_DURATION } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { RadioCardGroup } from "../onboarding/components/option-card";
import { FIELD_LABEL } from "./meeting-sheet/sheet-styles";

const CARD = {
  online: { icon: Video, tint: "bg-tint-blue text-tint-blue-foreground", name: "meetings.venue.online", hint: "meetings.venue.onlineHint" },
  in_person: { icon: UsersRound, tint: "bg-tint-violet text-tint-violet-foreground", name: "meetings.venue.inPerson", hint: "meetings.venue.inPersonHint" },
} as const;

/**
 * Hình thức (UNI-2247 boards 1–2): Online opens a room with a link, Trực tiếp
 * records in the room. Two cards in one radio group; read-only keeps both in
 * view and in the tab order but refuses a change.
 */
export function MeetingVenuePicker({
  value,
  onChange,
  readOnly,
  className,
}: {
  value: MeetingVenue;
  onChange: (v: MeetingVenue) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion() ?? false;
  const groupId = useId();
  return (
    <div className={className}>
      {/* The group carries the same name, so the visible label is not read twice. */}
      <p aria-hidden className={FIELD_LABEL}>
        {t("meetings.venue.label")}
      </p>
      {/* Scoped, so a second picker on the page never borrows this frame. */}
      <LayoutGroup id={groupId}>
        <RadioCardGroup label={t("meetings.venue.label")} className="grid grid-cols-2 gap-2">
          {MEETING_VENUES.map((v) => {
            const card = CARD[v];
            const checked = v === value;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={readOnly || undefined}
                onClick={() => !readOnly && !checked && onChange(v)}
                className={cn(
                  "relative isolate flex min-w-0 items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left not-aria-disabled:hover:bg-surface-hover aria-disabled:cursor-not-allowed",
                  checked && "border-transparent not-aria-disabled:hover:bg-transparent",
                )}
              >
                {checked ? (
                  // One selection frame glides between the cards (proposal C).
                  <motion.span
                    aria-hidden
                    data-slot="venue-frame"
                    layoutId="meeting-venue-frame"
                    transition={reduce ? { duration: 0 } : { duration: UI_MOTION_DURATION.settle, ease: UI_EASE_SETTLE }}
                    className="absolute -inset-px -z-10 rounded-lg border-[1.5px] border-primary bg-surface-selected shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_12%,transparent)]"
                  />
                ) : null}
                <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-md", card.tint)}>
                  <card.icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body font-medium text-foreground">{t(card.name)}</span>
                  <span className="truncate text-caption text-muted-foreground">{t(card.hint)}</span>
                </span>
                {checked ? (
                  <motion.span
                    aria-hidden
                    className="absolute top-2 right-2 grid size-4.5 place-items-center rounded-full bg-primary text-primary-foreground"
                    initial={reduce ? false : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: reduce ? 1 : [0.6, 1.08, 1] }}
                    transition={{ duration: 0.36, ease: UI_EASE_OUT }}
                  >
                    <Check className="size-3" />
                  </motion.span>
                ) : null}
              </button>
            );
          })}
        </RadioCardGroup>
      </LayoutGroup>
    </div>
  );
}
