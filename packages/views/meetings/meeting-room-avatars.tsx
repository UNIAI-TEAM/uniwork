"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MeetingParticipant } from "@uniwork/core/types";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { meetingAvatarTint } from "./meeting-detail/avatar-tint";
import { PARTICIPANT_IDENTITY_PREFIX } from "./meeting-signals";
import { personAvatarSrc } from "./meeting-person";
import { useMemberIndex } from "./use-member-index";

type AvatarOf = (key: string | null | undefined) => string | undefined;
type TintOf = (identity: string | null | undefined) => Tint;

type RoomAvatars = { ofIdentity: AvatarOf; ofUser: AvatarOf; tintOf: TintOf };

const NONE: AvatarOf = () => undefined;

const MeetingRoomAvatarsContext = createContext<RoomAvatars>({
  ofIdentity: NONE,
  ofUser: NONE,
  tintOf: () => meetingAvatarTint(null, []),
});

/** identity → workspace user, for the participants that are members; guests have none. */
export function roomUserIndex(participants: readonly MeetingParticipant[]): (identity: string | null | undefined) => string | undefined {
  const byIdentity = new Map<string, string>();
  for (const p of participants) if (p.user_id) byIdentity.set(`${PARTICIPANT_IDENTITY_PREFIX}${p.id}`, p.user_id);
  return (identity) => (identity ? byIdentity.get(identity) : undefined);
}

/**
 * identity → photo URL for everyone in the room. LiveKit only knows a
 * participant id (`uw_participant_<id>`); the meeting's participant list maps
 * it to a user, and the workspace members carry that user's avatar. Guests
 * have no user, so they keep their initials.
 */
export function roomAvatarIndex(
  participants: readonly MeetingParticipant[],
  avatarOfUser: (userId: string) => unknown,
): AvatarOf {
  const byIdentity = new Map<string, string>();
  for (const p of participants) {
    if (!p.user_id) continue;
    const src = personAvatarSrc(avatarOfUser(p.user_id));
    if (src) byIdentity.set(`${PARTICIPANT_IDENTITY_PREFIX}${p.id}`, src);
  }
  return (identity) => (identity ? byIdentity.get(identity) : undefined);
}

export function MeetingRoomAvatarsProvider({
  participants,
  workspaceId,
  children,
}: {
  participants: readonly MeetingParticipant[] | undefined;
  /** Empty for a guest, who cannot read the member list. */
  workspaceId: string;
  children: ReactNode;
}) {
  const { memberOf, members } = useMemberIndex(workspaceId);
  const value = useMemo<RoomAvatars>(() => {
    const userOf = roomUserIndex(participants ?? []);
    return {
      ofIdentity: roomAvatarIndex(participants ?? [], (userId) => memberOf(userId)?.avatar_url),
      ofUser: (userId) => personAvatarSrc(memberOf(userId)?.avatar_url),
      // One tint per person across the room: keyed by the workspace user, as the UNI tab and the detail page are.
      tintOf: (identity) => meetingAvatarTint(userOf(identity), members),
    };
  }, [participants, memberOf, members]);
  return <MeetingRoomAvatarsContext.Provider value={value}>{children}</MeetingRoomAvatarsContext.Provider>;
}

/** The photo for a LiveKit identity, when the room knows one. */
export function useRoomAvatarOf(): AvatarOf {
  return useContext(MeetingRoomAvatarsContext).ofIdentity;
}

/** The photo for a workspace user (a join request carries a user, not an identity). */
export function useUserAvatarOf(): AvatarOf {
  return useContext(MeetingRoomAvatarsContext).ofUser;
}

/** A LiveKit identity's face tint: its member's `meetingAvatarTint`, grey for a guest. */
export function useRoomTintOf(): TintOf {
  return useContext(MeetingRoomAvatarsContext).tintOf;
}
