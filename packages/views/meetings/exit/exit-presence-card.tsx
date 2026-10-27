"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingParticipant } from "@uniwork/core/types";
import { MeetingPersonAvatar } from "../meeting-person";
import { useRoomAvatarOf, useRoomTintOf } from "../meeting-room-avatars";
import { PARTICIPANT_IDENTITY_PREFIX } from "../meeting-signals";

const FACES = 4;

/** Elapsed time since `since`: mm:ss under an hour, h:mm:ss after. */
export function elapsedClock(since: string, now: number): string | null {
  const start = Date.parse(since);
  if (Number.isNaN(start)) return null;
  const total = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Its own leaf: it repaints every second, the screen around it does not. */
function LiveClock({ since }: { since: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = elapsedClock(since, now);
  if (!time) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 font-mono text-caption font-medium text-success-soft-foreground tabular-nums"
      aria-label={t("meetings.exit.elapsed", { time })}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {time}
    </span>
  );
}

/** Who is still in the room, as faces and a count, with how long the meeting has run. */
export function ExitPresenceCard({ people, startedAt }: { people: readonly MeetingParticipant[]; startedAt?: string }) {
  const { t } = useTranslation();
  const avatarOf = useRoomAvatarOf();
  const tintOf = useRoomTintOf();
  const shown = people.slice(0, FACES);
  const more = people.length - shown.length;
  return (
    <div className="flex w-full items-center gap-3.5 rounded-2xl border border-border bg-surface px-4 py-3.5 text-left">
      {shown.length > 0 ? (
        <div aria-hidden className="flex shrink-0 -space-x-2">
          {shown.map((p) => {
            const identity = PARTICIPANT_IDENTITY_PREFIX + p.id;
            return (
              <MeetingPersonAvatar
                key={p.id}
                name={p.display_name_snapshot ?? ""}
                avatarUrl={avatarOf(identity)}
                tint={tintOf(identity)}
                size={32}
                className="ring-2 ring-surface"
              />
            );
          })}
          {more > 0 ? (
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-hover text-caption font-semibold text-muted-foreground ring-2 ring-surface">
              +{more}
            </span>
          ) : null}
        </div>
      ) : null}
      <span className="min-w-0 flex-1 text-body text-foreground">
        {people.length > 0 ? t("meetings.exit.presence", { count: people.length }) : t("meetings.exit.presenceEmpty")}
      </span>
      {startedAt ? <LiveClock since={startedAt} /> : null}
    </div>
  );
}
