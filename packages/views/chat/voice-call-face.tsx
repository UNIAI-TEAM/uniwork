"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatRooms } from "@uniwork/core/chat";
import type { Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { tintSolidClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { WorkspaceIcon } from "../layout/workspace-icon";
import { workspaceTint } from "../layout/workspace-rail";
import { identityTint } from "../people/identity-tint";
import { initialsOf, roomInitialsOf } from "./chat-initials";
import { ChatRoomPhoto } from "./chat-room-mark";
import type { VoiceCallOverlayState } from "./voice-call-overlay-types";

type Face = { tint: Tint; text: string; square: boolean; imageUrl?: string };

/**
 * Who a call is with, drawn the way the conversation list draws them: a
 * person's initials on their own tint (round), a group's initials or a
 * channel's "#" on the room's tint (a squircle), and the workspace the room
 * lives in. Without a room record (tests, a room not loaded yet) the face
 * falls back to the name's initials on the brand.
 */
type VoiceCallIdentity = {
  face: Face;
  /** A group call's caller, the small face on the group's (ringing only). */
  caller?: Face;
  workspace?: { info: Workspace; tint: Tint };
};

const VoiceCallIdentityContext = createContext<VoiceCallIdentity | null>(null);

export function VoiceCallIdentityProvider({ value, children }: { value: VoiceCallIdentity | null; children: ReactNode }) {
  return <VoiceCallIdentityContext.Provider value={value}>{children}</VoiceCallIdentityContext.Provider>;
}

/** A room's face as the conversation list draws it; the name's initials on the brand without a record. */
export function chatRoomFaceOf(room: ChatRoomRecord | undefined, name: string): Face {
  if (room?.kind === "dm") return { tint: identityTint(room.peer_user_id ?? room.id), text: initialsOf(name), square: false };
  if (room?.kind === "channel") return { tint: identityTint(room.id), text: "#", square: true };
  if (room) return { tint: identityTint(room.id), text: roomInitialsOf(name), square: true, imageUrl: room.avatar_url };
  return { tint: "blue", text: initialsOf(name), square: false };
}

export function useVoiceCallIdentityValue(workspaceId: string, state: VoiceCallOverlayState): VoiceCallIdentity | null {
  const roomId = state.status === "idle" ? undefined : state.roomId;
  const peerName = state.status === "idle" ? "" : state.peerName;
  const callerId = state.status === "incoming" ? state.callerId : undefined;
  const callerName = state.status === "incoming" ? state.callerName : undefined;
  const { data: rooms } = useChatRooms(workspaceId);
  const { data: workspaces } = useWorkspaces(Boolean(roomId));
  return useMemo(() => {
    if (!roomId) return null;
    const room = rooms?.find((r) => r.id === roomId);
    const face = chatRoomFaceOf(room, peerName);
    const caller =
      callerId && callerName ? { tint: identityTint(callerId), text: initialsOf(callerName), square: false } : undefined;
    const home = room ? workspaces?.find((w) => w.id === room.workspace_id) : undefined;
    return {
      face,
      caller,
      workspace: home && workspaces ? { info: home, tint: workspaceTint(workspaces, home.id) } : undefined,
    };
  }, [roomId, peerName, callerId, callerName, rooms, workspaces]);
}

/* Each size: the face, its corner for a room squircle, and the initials. */
const FACE_SIZE = {
  /** The panel header and the fullscreen header. */
  sm: { box: "size-10", square: "rounded-xl", text: "text-body" },
  /** The minimized pill. */
  pill: { box: "size-11", square: "rounded-[14px]", text: "text-body" },
  /** The ended card. */
  md: { box: "size-22", square: "rounded-[26px]", text: "text-display" },
  /** The ringing card. */
  lg: { box: "size-24", square: "rounded-[30px]", text: "text-display" },
  /** The voice-only stage of a connected 1-1 call. */
  xl: { box: "size-30", square: "rounded-[36px]", text: "text-display" },
} as const;

type VoiceCallFaceSize = keyof typeof FACE_SIZE;

/** The call's face, from the overlay's identity (see VoiceCallIdentity). Decorative: the name is beside it. */
export function VoiceCallFace({
  peerName,
  size,
  className,
}: {
  peerName: string;
  size: VoiceCallFaceSize;
  className?: string;
}) {
  const identity = useContext(VoiceCallIdentityContext);
  const face = identity?.face ?? { tint: "blue" as const, text: initialsOf(peerName), square: false };
  const look = FACE_SIZE[size];
  const box = cn(look.box, face.square ? look.square : "rounded-full", className);
  return (
    <ChatRoomPhoto src={face.imageUrl} className={box}>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center font-display font-bold",
          size === "md" || size === "lg" || size === "xl" ? "font-extrabold" : null,
          tintSolidClass[face.tint],
          look.text,
          box,
        )}
      >
        {face.text}
      </span>
    </ChatRoomPhoto>
  );
}

/** Same shape as the face, for the pulse rings and the speaking ring drawn around it. */
export function useVoiceCallFaceIsSquare(): boolean {
  return useContext(VoiceCallIdentityContext)?.face.square ?? false;
}

/** A group call's caller, on the group's face while it rings ("VM" on "RM"). */
export function VoiceCallCallerBadge() {
  const caller = useContext(VoiceCallIdentityContext)?.caller;
  if (!caller) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute right-1.5 bottom-1.5 inline-flex size-9.5 items-center justify-center rounded-full border-3 border-call-plane font-display text-label font-bold",
        tintSolidClass[caller.tint],
      )}
    >
      {caller.text}
    </span>
  );
}

/** "TT Truyền thông": the workspace the call's room lives in. */
export function VoiceCallWorkspaceChip({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  const workspace = useContext(VoiceCallIdentityContext)?.workspace;
  if (!workspace) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-meeting-bar-chip-bg text-caption font-semibold text-call-muted-foreground",
        size === "md" ? "h-6 gap-1.5 pr-2.25 pl-0.75" : "h-5.5 gap-1.25 pr-2 pl-0.75",
        className,
      )}
    >
      <WorkspaceIcon
        workspace={workspace.info}
        className={cn(
          "inline-flex items-center justify-center text-micro leading-none font-bold",
          size === "md" ? "size-4.5 rounded-md" : "size-4 rounded-[5px]",
          tintSolidClass[workspace.tint],
        )}
      />
      {workspace.info.name}
    </span>
  );
}
