"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnectionState, useParticipants as useLiveKitParticipants } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { Circle, Clock, Crown, ShieldCheck, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuthStore } from "@uniwork/core/auth";
import { useParticipants } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { hostInRoom } from "./meeting-host-handover";
import { humanParticipants, ROSTER_EVENTS } from "./meeting-signals";

/** Long enough for the roster to arrive after a connect: the chip must not flash on every join. */
const SETTLE_MS = 3000;
const HOST_TOAST = "meeting-host-changed";

function useRoomSettled(): boolean {
  const connected = useConnectionState() === ConnectionState.Connected;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!connected || settled) return;
    const id = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [connected, settled]);
  return connected && settled;
}

/**
 * "The host is away", for everyone else in a live meeting: admitting people,
 * stopping a recording, extending and ending wait for them (or a workspace
 * admin, who is told they can act).
 */
export function MeetingHostAwayChip({ meeting, canHost }: { meeting: Meeting; canHost: boolean }) {
  const { t } = useTranslation();
  const viewerId = useAuthStore((s) => s.user?.id);
  const room = useLiveKitParticipants({ updateOnlyOn: ROSTER_EVENTS });
  const live = useMemo(() => new Set(humanParticipants(room).map((p) => p.identity)), [room]);
  const { data: participants } = useParticipants(meeting.id);
  const settled = useRoomSettled();
  if (!settled || !participants || meeting.status !== "IN_PROGRESS") return null;
  if (!meeting.host_user_id || viewerId === meeting.host_user_id) return null;
  if (hostInRoom(participants, live, meeting.host_user_id)) return null;
  const hostName = participants.find((p) => p.user_id === meeting.host_user_id)?.display_name_snapshot;
  const waits = [
    { icon: Users, label: t("meetings.hostAway.waitAdmit") },
    { icon: Circle, label: t("meetings.hostAway.waitRecord") },
    { icon: Clock, label: t("meetings.hostAway.waitEnd") },
  ];
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="meetingChip"
            size="sm"
            className="h-8 border-warning/60 px-2 text-warning hover:text-warning aria-expanded:text-warning data-popup-open:text-warning @4xl/stagehead:px-2.5"
            data-testid="meeting-host-away-chip"
          />
        }
      >
        <Crown aria-hidden className="size-4" />
        <span className="sr-only @4xl/stagehead:not-sr-only">{t("meetings.hostAway.chip")}</span>
      </PopoverTrigger>
      {/* `dark`: the popup portals to <body>, out of the dark stage it belongs to. */}
      <PopoverContent className="dark w-72 space-y-3">
        <p className="text-body font-medium">
          {hostName ? t("meetings.hostAway.titleNamed", { name: hostName }) : t("meetings.hostAway.chip")}
        </p>
        <p className="text-caption font-semibold text-muted-foreground">{t("meetings.hostAway.onlyHost")}</p>
        <ul className="space-y-1.5">
          {waits.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-caption text-muted-foreground">
              <Icon aria-hidden className="size-3.5 shrink-0" />
              {label}
            </li>
          ))}
        </ul>
        {canHost ? (
          <p className="flex items-center gap-2 rounded-lg bg-brand-subtle px-2.5 py-2 text-caption font-medium text-brand-subtle-foreground">
            <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
            {t("meetings.hostAway.youCanAct")}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Says who runs the room once the host role moves (host.transferred
 * refetches the meeting): "you are the host" to the one who got it, a quiet
 * notice to everyone else. The one who handed it on heard so from their own
 * dialog.
 */
export function MeetingHostChangeToasts({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const viewerId = useAuthStore((s) => s.user?.id);
  const hostUserId = meeting.host_user_id;
  const { data: participants } = useParticipants(meeting.id);
  const previous = useRef(hostUserId);
  useEffect(() => {
    const before = previous.current;
    previous.current = hostUserId;
    if (!before || !hostUserId || before === hostUserId || before === viewerId) return;
    if (hostUserId === viewerId) {
      toast.success(t("meetings.hostNowYou"), {
        id: HOST_TOAST,
        description: t("meetings.hostNowYouHint"),
        position: "top-center",
      });
      return;
    }
    const name = participants?.find((p) => p.user_id === hostUserId)?.display_name_snapshot;
    if (name) toast.info(t("meetings.hostNow", { name }), { id: HOST_TOAST, position: "top-center" });
  }, [hostUserId, viewerId, participants, t]);
  return null;
}
