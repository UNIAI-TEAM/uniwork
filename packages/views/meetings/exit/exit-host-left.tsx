"use client";

import { useId, useState, type ReactNode } from "react";
import { ArrowRightLeft, Crown, PhoneOff, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRecordings, useStopRecording } from "@uniwork/core/meetings";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { toastApiError } from "../../toast-api-error";
import { MeetingPersonAvatar } from "../meeting-person";
import { useJoinRequestActions } from "../use-join-request-actions";
import { usePendingJoinRequests } from "../use-pending-join-requests";
import { ExitActions, ExitBottom, ExitMediaChips, ExitStory, RejoinButton } from "./exit-left";
import type { ExitMedia } from "./exit-model";
import { ExitHandoverPicker } from "./exit-handover-picker";
import { elapsedClock } from "./exit-presence-card";
import { ExitHeading, ExitMark } from "./exit-shell";

const KNOCK_FACES = 2;

/**
 * What still waits for the host while they are out (board B): people
 * knocking, and a recording only the host can stop. Both act from here.
 */
function WaitingForYou({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const headingId = useId();
  const { pending, count } = usePendingJoinRequests(meetingId);
  const { admitAll, approving } = useJoinRequestActions(meetingId);
  const { data: recordings } = useRecordings(meetingId);
  const stop = useStopRecording(meetingId);
  const active = (recordings ?? []).find((r) => r.status === "ACTIVE");
  if (count === 0 && !active) return null;
  const recordedFor = active?.started_at ? elapsedClock(active.started_at, Date.now()) : null;
  return (
    <section
      aria-labelledby={headingId}
      className="w-full overflow-hidden rounded-2xl border border-warning/35 bg-surface text-left"
    >
      <h2 id={headingId} className="flex items-center gap-2 bg-warning-soft px-4 py-3 text-label font-semibold text-warning-soft-foreground">
        <TriangleAlert aria-hidden className="size-3.5" />
        {t("meetings.exit.hostLeft.waiting")}
      </h2>
      {count > 0 ? (
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
          <div aria-hidden className="flex shrink-0 -space-x-2">
            {pending.slice(0, KNOCK_FACES).map((r) => (
              <MeetingPersonAvatar key={r.id} name={r.display_name_snapshot ?? ""} size={28} className="ring-2 ring-surface" />
            ))}
          </div>
          <span className="min-w-0 flex-1 text-body text-foreground">{t("meetings.exit.hostLeft.knocking", { count })}</span>
          <Button
            type="button"
            className="h-9 shrink-0 rounded-[10px] bg-foreground px-3.5 text-label font-semibold text-background hover:bg-foreground/90"
            aria-disabled={approving || undefined}
            onClick={() => {
              if (!approving) void admitAll(pending);
            }}
          >
            {t("meetings.exit.hostLeft.admit")}
          </Button>
        </div>
      ) : null}
      {active ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive-soft">
            <span className="size-2 rounded-full bg-destructive" />
          </span>
          <span className="min-w-0 flex-1 text-body text-foreground">
            {t("meetings.exit.hostLeft.recording")}
            {recordedFor ? <span className="ml-1.5 font-mono text-muted-foreground tabular-nums">{recordedFor}</span> : null}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 rounded-[10px] px-3.5 text-label"
            aria-disabled={stop.isPending || undefined}
            onClick={() => {
              if (!stop.isPending) stop.mutate(undefined, { onError: (err) => toastApiError(err, t("common.error")) });
            }}
          >
            {t("meetings.exit.hostLeft.stopRecording")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Board B: the host stepped out and still runs the room. */
export function ExitHostLeft({
  meeting,
  workspaceId,
  media,
  presence,
  participants,
  onRejoin,
  onEndForAll,
  onHandedOver,
  onRefreshPresence,
}: {
  meeting: Meeting;
  workspaceId: string;
  media: ExitMedia;
  presence: ReactNode;
  participants: readonly MeetingParticipant[];
  onRejoin: () => void;
  onEndForAll?: () => void;
  onHandedOver: (userId: string, name: string) => void;
  onRefreshPresence: () => void;
}) {
  const { t } = useTranslation();
  const phone = useIsMobile();
  const [picking, setPicking] = useState(false);
  const story = (
    <>
      <ExitMark className="bg-brand-subtle text-brand-subtle-foreground ring-brand/10">
        <Crown aria-hidden />
      </ExitMark>
      <ExitHeading title={t("meetings.exit.left.title")}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-body-lg text-muted-foreground">{meeting.title}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-2.5 py-0.5 text-caption font-medium text-brand-subtle-foreground">
            <Crown aria-hidden className="size-3" />
            {t("meetings.exit.hostLeft.stillHost")}
          </span>
        </div>
      </ExitHeading>
      {presence}
      <WaitingForYou meetingId={meeting.id} />
    </>
  );
  const actions = (
    <ExitActions
      primary={<RejoinButton onClick={onRejoin} />}
      secondary={
        <Button type="button" variant="outline" size="lg" className="min-h-12 rounded-xl text-body-lg" onClick={() => setPicking(true)}>
          <ArrowRightLeft aria-hidden className="size-4" />
          {t("meetings.exit.hostLeft.handover")}
        </Button>
      }
    />
  );
  const end = onEndForAll ? (
    <Button type="button" variant="ghost" className="min-h-11 text-destructive hover:text-destructive" onClick={onEndForAll}>
      <PhoneOff aria-hidden className="size-4" />
      {t("meetings.hostLeave.endAll")}
    </Button>
  ) : null;
  return (
    <>
      {phone ? (
        <>
          <ExitStory>
            {story}
            <ExitMediaChips media={media} />
          </ExitStory>
          <ExitBottom>
            {actions}
            {end}
          </ExitBottom>
        </>
      ) : (
        <>
          {story}
          <div className="flex w-full flex-col items-center gap-3">
            {actions}
            {end}
          </div>
        </>
      )}
      <ExitHandoverPicker
        open={picking}
        onOpenChange={setPicking}
        meeting={meeting}
        workspaceId={workspaceId}
        participants={participants}
        onHandedOver={(userId, name) => {
          setPicking(false);
          onHandedOver(userId, name);
        }}
        onRefresh={onRefreshPresence}
      />
    </>
  );
}
