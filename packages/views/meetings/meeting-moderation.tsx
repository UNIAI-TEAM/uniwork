"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { ParticipantEvent, type Participant } from "livekit-client";
import { Lock, LockOpen, MicOff, UserMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useRemoveParticipant, useSetParticipantPublish } from "@uniwork/core/meetings";
import { DropdownMenuItem, DropdownMenuSeparator } from "@uniwork/ui/components/ui/dropdown-menu";
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { micLockedNow, PARTICIPANT_IDENTITY_PREFIX } from "./meeting-signals";
import { useRequestMute } from "./use-meeting-signals";

function participantIdFromIdentity(identity: string): string | null {
  return identity.startsWith(PARTICIPANT_IDENTITY_PREFIX)
    ? identity.slice(PARTICIPANT_IDENTITY_PREFIX.length)
    : null;
}

function displayName(participant: Participant): string {
  return participant.name || participant.identity;
}

type Moderation = {
  /** Lock (false) or unlock (true) someone's mic: only the host can undo a lock. */
  setMicLocked: (participant: Participant, locked: boolean) => void;
  askRemove: (participant: Participant) => void;
};

const ModerationCtx = createContext<Moderation | null>(null);

/**
 * The host's actions on a person, shared by the stage tiles and the People
 * tab so both menus offer the same things, and one confirm dialog for
 * removing someone. A viewer who cannot host gets no context, so no items.
 */
export function MeetingModerationProvider({
  meetingId,
  canHost,
  children,
}: {
  meetingId?: string;
  canHost: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const remove = useRemoveParticipant(meetingId ?? "");
  const setPublish = useSetParticipantPublish(meetingId ?? "");
  const [removing, setRemoving] = useState<Participant | null>(null);

  const value: Moderation | null =
    canHost && meetingId
      ? {
          setMicLocked: (participant, locked) => {
            const participantId = participantIdFromIdentity(participant.identity);
            if (!participantId) return;
            setPublish.mutate(
              { participantId, enabled: !locked },
              { onError: (err) => toastApiError(err, t("common.error")) },
            );
          },
          askRemove: setRemoving,
        }
      : null;

  const confirmRemove = () => {
    const participantId = removing ? participantIdFromIdentity(removing.identity) : null;
    if (!participantId) return;
    remove.mutate(participantId, {
      onSuccess: () => setRemoving(null),
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <ModerationCtx.Provider value={value}>
      {children}
      {value ? (
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
          title={t("meetings.removeFromCallTitle", { name: removing ? displayName(removing) : "" })}
          description={t("meetings.removeFromCallHint")}
          confirmLabel={t("meetings.removeFromCall")}
          pending={remove.isPending}
          onConfirm={confirmRemove}
        />
      ) : null}
    </ModerationCtx.Provider>
  );
}

const MIC_LOCK_TOAST = "meeting-mic-lock";

/**
 * Whether this person's mic is locked (see micLockedNow). Unlike a muted mic,
 * only the host can lift it.
 */
export function useMicLocked(participant: Participant): boolean {
  const [locked, setLocked] = useState(() => micLockedNow(participant));
  useEffect(() => {
    const update = () => setLocked(micLockedNow(participant));
    update();
    participant.on(ParticipantEvent.ParticipantPermissionsChanged, update);
    return () => {
      participant.off(ParticipantEvent.ParticipantPermissionsChanged, update);
    };
  }, [participant]);
  return locked;
}

/**
 * The viewer's own mic lock: `locked`, and `explain()` for a click on a mic
 * that cannot turn on. A lock or an unlock is announced once, as it happens,
 * so the mic never just stops answering.
 */
export function useOwnMicLock(): { locked: boolean; explain: () => void } {
  const { t } = useTranslation();
  const { localParticipant } = useLocalParticipant();
  const locked = useMicLocked(localParticipant);
  const previous = useRef(locked);
  // One id for every lock notice: a click on the mic while the lock notice
  // is still up refreshes it instead of stacking a second one.
  const explain = useCallback(
    () =>
      toast.info(t("meetings.micLockedYou"), {
        id: MIC_LOCK_TOAST,
        description: t("meetings.micLockedYouHint"),
        position: "top-center",
      }),
    [t],
  );
  useEffect(() => {
    if (previous.current === locked) return;
    previous.current = locked;
    if (locked) explain();
    else toast.info(t("meetings.micUnlockedYou"), { id: MIC_LOCK_TOAST, position: "top-center" });
  }, [locked, explain, t]);
  return { locked, explain };
}

/**
 * The host's items in a person's menu, after a separator from the viewing
 * items: mute (they may unmute), lock (only the host unlocks), remove.
 * One icon per meaning — a crossed mic is only ever "mute".
 */
export function MeetingModerationMenuItems({
  participant,
  micMuted,
  separated = true,
}: {
  participant: Participant;
  micMuted: boolean;
  /** False when nothing sits above these items (a share's menu). */
  separated?: boolean;
}) {
  const { t } = useTranslation();
  const moderation = useContext(ModerationCtx);
  const requestMute = useRequestMute();
  const locked = useMicLocked(participant);
  // No participant id, no row to act on: offer nothing rather than a confirm that cannot work.
  if (!moderation || participant.isLocal || !participantIdFromIdentity(participant.identity)) return null;
  const name = displayName(participant);
  const canMute = !micMuted && !locked;
  return (
    <>
      {separated ? <DropdownMenuSeparator /> : null}
      {canMute ? (
        <DropdownMenuItem onClick={() => requestMute(participant.identity, name)}>
          <MicOff aria-hidden className="size-4" />
          {t("meetings.muteParticipant", { name })}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={() => moderation.setMicLocked(participant, !locked)}>
        {locked ? <LockOpen aria-hidden className="size-4" /> : <Lock aria-hidden className="size-4" />}
        {locked ? t("meetings.unlockMic", { name }) : t("meetings.lockMic", { name })}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => moderation.askRemove(participant)}>
        <UserMinus aria-hidden className="size-4" />
        {t("meetings.removeParticipant", { name })}
      </DropdownMenuItem>
    </>
  );
}
