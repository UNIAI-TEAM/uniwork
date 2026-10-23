"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { ParticipantEvent, Track, type Participant } from "livekit-client";
import { Lock, LockOpen, MicOff, MonitorUp, ScreenShareOff, UserMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useMeeting,
  useParticipants,
  useRemoveParticipant,
  useSetParticipantPublish,
} from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { micLockedNow, PARTICIPANT_IDENTITY_PREFIX } from "./meeting-signals";
import { useMeetingSignals, useRequestMute } from "./use-meeting-signals";

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
  /** Stop and lock someone's screen share (with its audio), or let them share again. */
  setShareLocked: (participant: Participant, locked: boolean) => void;
  askRemove: (participant: Participant) => void;
  /** The meeting host's seats: their share cannot be locked (the server answers 409). */
  hostIdentities: ReadonlySet<string>;
  /** Whether hostIdentities is read yet: until then any seat may be the host's. */
  hostsKnown: boolean;
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
  // Both are already loaded for the room; a viewer who cannot host reads neither.
  const { data: meeting } = useMeeting(meetingId ?? "", { enabled: canHost });
  const { data: apiParticipants } = useParticipants(canHost ? (meetingId ?? "") : "");
  // Exactly the server's rule: the meeting host's own seats, not every HOST role.
  const hostIdentities = useMemo(
    () =>
      new Set(
        (apiParticipants ?? [])
          .filter((p) => meeting?.host_user_id && p.user_id === meeting.host_user_id)
          .map((p) => `${PARTICIPANT_IDENTITY_PREFIX}${p.id}`),
      ),
    [apiParticipants, meeting?.host_user_id],
  );

  const lock = (participant: Participant, enabled: boolean, source: "microphone" | "screen_share") => {
    const participantId = participantIdFromIdentity(participant.identity);
    if (!participantId) return;
    setPublish.mutate(
      { participantId, enabled, source },
      { onError: (err) => toastApiError(err, t("common.error")) },
    );
  };

  const value: Moderation | null =
    canHost && meetingId
      ? {
          setMicLocked: (participant, locked) => lock(participant, !locked, "microphone"),
          setShareLocked: (participant, locked) => lock(participant, !locked, "screen_share"),
          askRemove: setRemoving,
          hostIdentities,
          hostsKnown: meeting !== undefined && apiParticipants !== undefined,
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
 * One id for every notice about the viewer's own share ending or being
 * locked: whichever of LiveKit's two events lands first, the lock notice
 * replaces a "share stopped" one instead of stacking under it.
 */
export const SHARE_NOTICE_TOAST = "meeting-share-notice";

// TrackSource.SCREEN_SHARE and SCREEN_SHARE_AUDIO in @livekit/protocol, which views does not import.
const SCREEN_SHARE_SOURCE = 3;
const SCREEN_SHARE_AUDIO_SOURCE = 4;

type PublishPermissions = { permissions?: { canPublishSources?: readonly number[] } | null };

/**
 * Whether the host has locked this person's screen share: their publish
 * sources list others but not the share (an empty list allows every source),
 * mirroring micLockedNow.
 */
export function shareLockedNow(participant: PublishPermissions): boolean {
  const sources = participant.permissions?.canPublishSources ?? [];
  return sources.length > 0 && !sources.includes(SCREEN_SHARE_SOURCE);
}

/**
 * Whether a share may carry its audio. A locked mic takes shared audio away
 * too, and LiveKit fails the whole share when one of its tracks is refused.
 */
export function shareAudioAllowedNow(participant: PublishPermissions): boolean {
  const sources = participant.permissions?.canPublishSources ?? [];
  return sources.length === 0 || sources.includes(SCREEN_SHARE_AUDIO_SOURCE);
}

/** A reading of someone's publish permissions, kept current as the host changes them. */
export function usePublishPermission(participant: Participant, read: (p: Participant) => boolean): boolean {
  const [value, setValue] = useState(() => read(participant));
  useEffect(() => {
    const update = () => setValue(read(participant));
    update();
    participant.on(ParticipantEvent.ParticipantPermissionsChanged, update);
    return () => {
      participant.off(ParticipantEvent.ParticipantPermissionsChanged, update);
    };
  }, [participant, read]);
  return value;
}

/**
 * Whether this person's mic is locked (see micLockedNow). Unlike a muted mic,
 * only the host can lift it.
 */
export function useMicLocked(participant: Participant): boolean {
  return usePublishPermission(participant, micLockedNow);
}

/** Whether this person's screen share is locked (see shareLockedNow). */
function useShareLocked(participant: Participant): boolean {
  return usePublishPermission(participant, shareLockedNow);
}

const sharingNow = (p: Participant) => Boolean(p.getTrackPublication(Track.Source.ScreenShare));

/** Whether this person is sharing their screen now, kept current as shares start and stop. */
function useIsSharing(participant: Participant): boolean {
  const [sharing, setSharing] = useState(() => sharingNow(participant));
  useEffect(() => {
    const update = () => setSharing(sharingNow(participant));
    update();
    participant.on(ParticipantEvent.TrackPublished, update);
    participant.on(ParticipantEvent.TrackUnpublished, update);
    return () => {
      participant.off(ParticipantEvent.TrackPublished, update);
      participant.off(ParticipantEvent.TrackUnpublished, update);
    };
  }, [participant]);
  return sharing;
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
    // Same id as the lock notice, whose hint sonner would otherwise keep.
    else toast.info(t("meetings.micUnlockedYou"), { id: MIC_LOCK_TOAST, description: undefined, position: "top-center" });
  }, [locked, explain, t]);
  return { locked, explain };
}

/**
 * The viewer's own share lock, like useOwnMicLock: `locked`, and `explain()`
 * for a click on Share. Announced once as it happens; `announce` is false
 * where a screen cannot be shared at all. `wasSharing` says whether the lock
 * ended a share, which LiveKit may report just before or just after it.
 */
export function useOwnShareLock({
  announce,
  wasSharing,
}: {
  announce: boolean;
  wasSharing: () => boolean;
}): { locked: boolean; explain: () => void } {
  const { t } = useTranslation();
  const { localParticipant } = useLocalParticipant();
  const locked = useShareLocked(localParticipant);
  const previous = useRef(locked);
  const wasSharingRef = useRef(wasSharing);
  wasSharingRef.current = wasSharing;
  const explain = useCallback(
    (stopped = false) =>
      toast.info(stopped ? t("meetings.shareLockStoppedYou") : t("meetings.shareLockedYou"), {
        id: SHARE_NOTICE_TOAST,
        description: t("meetings.shareLockedYouHint"),
        position: "top-center",
      }),
    [t],
  );
  useEffect(() => {
    if (previous.current === locked) return;
    previous.current = locked;
    if (!announce) return;
    if (locked) explain(wasSharingRef.current());
    // Same id as the lock notice, whose hint sonner would otherwise keep.
    else
      toast.info(t("meetings.shareLockLiftedYou"), {
        id: SHARE_NOTICE_TOAST,
        description: undefined,
        position: "top-center",
      });
  }, [locked, announce, explain, t]);
  return { locked, explain: () => explain() };
}

/**
 * The host's items in a person's menu, after a separator from the viewing
 * items: mute (they may unmute), lock the mic and the share (only the host
 * unlocks), remove.
 * One icon per meaning — a crossed mic is only ever "mute".
 */
export function MeetingModerationMenuItems({
  participant,
  micMuted,
  separated = true,
  removable = true,
}: {
  participant: Participant;
  micMuted: boolean;
  /** False when nothing sits above these items (a share's menu). */
  separated?: boolean;
  /** False on the meeting host's row: the host is never removed (the server answers 409). */
  removable?: boolean;
}) {
  const { t } = useTranslation();
  const moderation = useContext(ModerationCtx);
  const requestMute = useRequestMute();
  const locked = useMicLocked(participant);
  const shareLocked = useShareLocked(participant);
  const sharing = useIsSharing(participant);
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
      {/* Not until the host's seats are known: the meeting host's tile would
          offer a lock the server refuses. */}
      {!moderation.hostsKnown || moderation.hostIdentities.has(participant.identity) ? null : (
        <DropdownMenuItem onClick={() => moderation.setShareLocked(participant, !shareLocked)}>
          {shareLocked ? <MonitorUp aria-hidden className="size-4" /> : <ScreenShareOff aria-hidden className="size-4" />}
          {shareLocked
            ? t("meetings.unlockShare", { name })
            : sharing
              ? t("meetings.stopAndLockShare", { name })
              : t("meetings.lockShare", { name })}
        </DropdownMenuItem>
      )}
      {removable ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => moderation.askRemove(participant)}>
            <UserMinus aria-hidden className="size-4" />
            {t("meetings.removeParticipant", { name })}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/**
 * The host's "mute everyone", behind a confirm: one data-channel message that
 * every client but the hosts' honours by muting itself (each may unmute).
 * Nothing for a viewer who cannot host.
 */
export function MeetingMuteAllButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const moderation = useContext(ModerationCtx);
  const { requestMuteAll } = useMeetingSignals();
  const [confirming, setConfirming] = useState(false);
  if (!moderation) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("h-9 w-full rounded-xl", className)}
        onClick={() => setConfirming(true)}
      >
        <MicOff aria-hidden className="size-4" />
        {t("meetings.muteEveryone")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("meetings.muteEveryoneTitle")}
        description={t("meetings.muteEveryoneHint")}
        confirmLabel={t("meetings.muteEveryone")}
        destructive={false}
        onConfirm={() => {
          requestMuteAll();
          setConfirming(false);
        }}
      />
    </>
  );
}
