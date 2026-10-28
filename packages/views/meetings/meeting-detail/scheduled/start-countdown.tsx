"use client";
import { useEffect, useState } from "react";
import { Check, ClockFading } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { NumberFlow, NumberFlowGroup } from "@uniwork/ui/components/ui/number-flow";
import { UI_EASE_OUT, UI_EASE_SETTLE, UI_MOTION_DURATION } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "../../meeting-person";
import { useNow } from "../../use-now";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { rsvpState, type RsvpState } from "./rsvp-model";

/** The ring counts down the last hour before the start. */
export const COUNTDOWN_MS = 60 * 60_000;
const TWO_DIGITS = { minimumIntegerDigits: 2 } as const;
const R = 18;
const CIRCUMFERENCE = 2 * Math.PI * R;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The last hour before the start (proposal B): a ring that empties with the
 * time left and mm:ss rolling each second. One 1-second clock, and every tick
 * reads Date.now(), so a tab that slept wakes on the right time.
 */
export function StartCountdown({ startsAt }: { startsAt: string }) {
  const { t } = useTranslation();
  const now = useNow(1_000);
  const left = Math.min(COUNTDOWN_MS, Math.max(0, Date.parse(startsAt) - now));
  const seconds = Math.ceil(left / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const progress = Math.round((left / COUNTDOWN_MS) * 1000) / 1000;
  return (
    <div className="flex items-center gap-3">
      <svg aria-hidden viewBox="0 0 44 44" data-progress={progress} className="size-11 shrink-0 -rotate-90">
        <circle cx={22} cy={22} r={R} fill="none" strokeWidth={4} className="stroke-muted" />
        <circle
          cx={22}
          cy={22}
          r={R}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          className="stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
        />
      </svg>
      <div className="flex flex-col">
        <span role="timer" aria-label={t("meetings.motion.upcoming.startsIn", { time: `${pad(mm)}:${pad(ss)}` })} className="text-display-sm font-semibold tabular-nums text-foreground">
          <span aria-hidden className="inline-flex items-center">
            <NumberFlowGroup>
              <NumberFlow value={mm} format={TWO_DIGITS} />:<NumberFlow value={ss} format={TWO_DIGITS} />
            </NumberFlowGroup>
          </span>
        </span>
        <span className="text-caption text-muted-foreground">{t("meetings.motion.upcoming.startsAt", { time: clock(startsAt) })}</span>
      </div>
    </div>
  );
}

export type RsvpFace = { id: string; name: string; avatarUrl?: unknown; tint?: Tint; state: RsvpState };

const FACE_LIMIT = 5;
/** The ✓ pops for 360 ms and fades 900 ms later. */
const CHECK_MS = 1_260;

type Order = { ids: string[]; accepted: ReadonlySet<string>; fresh: string[] };

function initialOrder(faces: readonly RsvpFace[]): Order {
  const accepted = faces.filter((f) => f.state === "ACCEPTED").map((f) => f.id);
  return { ids: [...accepted, ...faces.filter((f) => f.state !== "ACCEPTED").map((f) => f.id)], accepted: new Set(accepted), fresh: [] };
}

/**
 * The invitees as faces: an answer still to come is faded with a dashed
 * edge, a yes is in full colour. Whoever says yes while the page is open
 * lights up, shows a ✓ and moves to the front. "N chờ" counts the rest.
 */
export function RsvpFaces({ faces }: { faces: readonly RsvpFace[] }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion() ?? false;
  const [order, setOrder] = useState(() => initialOrder(faces));
  const accepted = faces.filter((f) => f.state === "ACCEPTED").map((f) => f.id);
  const turned = accepted.filter((id) => !order.accepted.has(id));
  const added = faces.filter((f) => !order.ids.includes(f.id) && !turned.includes(f.id)).map((f) => f.id);
  if (turned.length > 0 || added.length > 0 || accepted.length !== order.accepted.size) {
    setOrder({
      ids: [...turned, ...order.ids.filter((id) => !turned.includes(id)), ...added],
      accepted: new Set(accepted),
      fresh: [...order.fresh, ...turned],
    });
  }
  useEffect(() => {
    if (order.fresh.length === 0) return;
    const timer = setTimeout(() => setOrder((o) => ({ ...o, fresh: [] })), CHECK_MS);
    return () => clearTimeout(timer);
  }, [order.fresh]);

  const byId = new Map(faces.map((f) => [f.id, f]));
  const shown = order.ids.flatMap((id) => byId.get(id) ?? []);
  const pending = faces.filter((f) => f.state === "PENDING");
  const settle = reduce ? { duration: 0 } : { duration: UI_MOTION_DURATION.settle, ease: UI_EASE_SETTLE };
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="flex items-center gap-0.5">
        {shown.slice(0, FACE_LIMIT).map((face) => (
          <motion.span key={face.id} layout="position" transition={settle} data-face={face.id} data-state={face.state} className="relative inline-flex rounded-full">
            <MeetingPersonAvatar
              name={face.name}
              avatarUrl={face.avatarUrl}
              size={28}
              tint={face.tint}
              className={cn(
                "ring-2 ring-background transition-[opacity,filter] duration-(--duration-standard) ease-out-quart",
                face.state !== "ACCEPTED" && face.state !== "TENTATIVE" && "opacity-45 grayscale",
                face.state === "PENDING" && "outline-[1.5px] outline-offset-0 outline-muted-foreground outline-dashed",
              )}
            />
            {order.fresh.includes(face.id) ? (
              <motion.span
                className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-success-solid text-on-solid ring-2 ring-background"
                initial={reduce ? false : { opacity: 0, scale: 0.6 }}
                // Pops (.6 → 1.08 → 1 in 360 ms), holds, fades from 900 ms; it is gone before the state drops it.
                animate={reduce ? undefined : { opacity: [0, 1, 1, 1, 0], scale: [0.6, 1.08, 1, 1, 0.8] }}
                transition={{ duration: CHECK_MS / 1000, times: [0, 0.17, 0.29, 0.71, 1], ease: UI_EASE_OUT }}
              >
                <Check className="size-3" />
              </motion.span>
            ) : null}
          </motion.span>
        ))}
        {shown.length > FACE_LIMIT ? (
          <span className="inline-grid h-7 min-w-7 place-items-center rounded-full bg-muted px-1 text-micro font-semibold text-muted-foreground ring-2 ring-background">
            {t("meetings.moreParticipantsShort", { count: shown.length - FACE_LIMIT })}
          </span>
        ) : null}
      </span>
      {pending.length > 0 ? (
        <span data-slot="rsvp-waiting" className="inline-flex h-6.5 items-center gap-1.5 rounded-full bg-muted px-2.5 text-caption font-medium text-muted-foreground">
          <ClockFading aria-hidden className="size-3.5" />
          <span aria-hidden className="inline-flex items-center gap-1">
            <NumberFlow value={pending.length} />
            {t("meetings.motion.upcoming.waiting")}
          </span>
          <span className="sr-only">{t("meetings.detail.strip.notAnswered", { count: pending.length, names: pending.map((f) => f.name).join(", ") })}</span>
        </span>
      ) : null}
    </div>
  );
}

/** The start row's lead inside the last hour: the countdown, a hairline, then the invitees' faces. */
export function UpcomingBrief() {
  const { meeting, participants, invitations, memberIndex } = useDetail();
  const faces: RsvpFace[] = participants.map((p) => {
    const invitation = invitations.find((inv) => inv.participant_id === p.id);
    const member = memberIndex.memberOf(p.user_id);
    return {
      id: p.id,
      name: p.display_name_snapshot || member?.display_name || "",
      avatarUrl: member?.avatar_url,
      tint: meetingAvatarTint(p.user_id, memberIndex.members),
      // The host carries no invitation of their own: they are coming.
      state: invitation ? rsvpState(invitation.response_status) : "ACCEPTED",
    };
  });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
      <StartCountdown startsAt={meeting.starts_at} />
      <span aria-hidden className="my-1 w-px self-stretch bg-border" />
      <RsvpFaces faces={faces} />
    </div>
  );
}
