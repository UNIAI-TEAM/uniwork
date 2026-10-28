"use client";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";
import { NumberFlow, NumberFlowGroup } from "@uniwork/ui/components/ui/number-flow";
import { UI_EASE_OUT, UI_POP } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import type { StackPerson } from "./meeting-detail/ui/avatar-stack";
import { MeetingPersonAvatar } from "./meeting-person";
import { useNow } from "./use-now";

/** NumberFlow's format for a clock field, and `pad` for the same field as text. */
export const TWO_DIGITS = { minimumIntegerDigits: 2 } as const;
export const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Time in the room since `since`, as mm:ss (h:mm:ss from an hour). It is
 * derived from the shared 1-second clock on every tick, never counted up, so
 * a tab that slept wakes on the right time; only the clock re-renders each second.
 */
export function ElapsedClock({ since }: { since: string }) {
  const { t } = useTranslation();
  const now = useNow(1_000);
  const total = Math.floor((now - Date.parse(since)) / 1000);
  if (!Number.isFinite(total)) return null;
  const s = Math.max(0, total);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  const time = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(Math.floor(s / 60))}:${pad(sec)}`;
  return (
    <span role="timer" aria-label={t("meetings.motion.list.elapsed", { time })} className="inline-flex items-center text-caption font-medium tabular-nums text-success-soft-foreground">
      <span aria-hidden className="inline-flex items-center">
        <NumberFlowGroup>
          {h > 0 ? (
            <>
              <NumberFlow value={h} />:
            </>
          ) : null}
          <NumberFlow value={h > 0 ? m : Math.floor(s / 60)} format={TWO_DIGITS} />:<NumberFlow value={sec} format={TWO_DIGITS} />
        </NumberFlowGroup>
      </span>
    </span>
  );
}

/** The face pop of the proposal: .6 → 1.08 → 1 in 360 ms, each one 120 ms after the last. */
function pop(i: number, reduce: boolean) {
  if (reduce) return { initial: false as const };
  return { ...UI_POP, transition: { ...UI_POP.transition, delay: i * 0.12 } };
}

/**
 * Who is in a live meeting's room, in place of the host's face: up to three
 * members, "+n" for everyone else (guests included), and Thư ký UNI's mark
 * while it takes notes. The faces are for the eye; the sentence is for a
 * screen reader.
 */
export function LiveRowFaces({ people, count, scribe }: { people: readonly StackPerson[]; count: number; scribe: boolean }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion() ?? false;
  const total = Math.max(count, people.length);
  const more = total - people.length;
  return (
    <span data-slot="live-faces" className="flex shrink-0 items-center gap-0.5 max-sm:hidden">
      <span className="sr-only">
        {t("meetings.motion.list.inRoom", { count: total })}
        {scribe ? `, ${t("meetings.motion.list.scribeLive")}` : null}
      </span>
      {people.map((person, i) => (
        <motion.span key={person.id} aria-hidden className="inline-flex rounded-full" {...pop(i, reduce)}>
          <MeetingPersonAvatar name={person.name} avatarUrl={person.avatarUrl} size={26} tint={person.tint} className="ring-2 ring-surface" />
        </motion.span>
      ))}
      {more > 0 ? (
        <span aria-hidden className="inline-grid h-6.5 min-w-6.5 place-items-center rounded-full bg-muted px-1 text-micro font-semibold text-muted-foreground ring-2 ring-surface">
          {t("meetings.moreParticipantsShort", { count: more })}
        </span>
      ) : null}
      {scribe ? (
        <motion.span aria-hidden className="inline-flex" {...pop(people.length, reduce)}>
          <ScribeMark size={26} state={reduce ? "idle" : "live"} />
        </motion.span>
      ) : null}
    </span>
  );
}

/** The live rail: the success bar with a light running down it every 2.4 s. */
export function LiveRail({ className }: { className?: string }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <span aria-hidden className={cn("relative w-1 self-stretch overflow-hidden rounded-full bg-success", className)}>
      {reduce ? null : (
        <motion.span
          data-motion-loop=""
          className="absolute inset-x-0 top-0 h-3/5 bg-linear-to-b from-transparent via-on-solid/70 to-transparent"
          initial={{ y: "-100%" }}
          animate={{ y: "170%" }}
          transition={{ duration: 2.4, ease: UI_EASE_OUT, repeat: Infinity }}
        />
      )}
    </span>
  );
}
