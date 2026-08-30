import type { MatrixClient } from "matrix-js-sdk";
import { RoomEvent, type MatrixEvent } from "matrix-js-sdk";

type SendCustomMatrixEvent = (
  roomId: string,
  type: string,
  content: Record<string, unknown>,
) => ReturnType<MatrixClient["sendEvent"]>;

export const VOICE_CALL_EVENT_TYPE = "uniwork.voice.call";

export type VoiceCallSignalAction = "invite" | "hangup";

export interface VoiceCallSignalContent {
  call_id: string;
  action: VoiceCallSignalAction;
}

export function parseVoiceCallSignal(raw: unknown): VoiceCallSignalContent | null {
  if (!raw || typeof raw !== "object") return null;
  const content = raw as Record<string, unknown>;
  if (typeof content.call_id !== "string" || !content.call_id.trim()) return null;
  if (content.action !== "invite" && content.action !== "hangup") return null;
  return { call_id: content.call_id, action: content.action };
}

export async function sendVoiceCallInvite(
  client: MatrixClient,
  roomId: string,
  callId: string,
): Promise<void> {
  await (client.sendEvent as SendCustomMatrixEvent)(roomId, VOICE_CALL_EVENT_TYPE, {
    call_id: callId,
    action: "invite",
  });
}

export async function sendVoiceCallHangup(
  client: MatrixClient,
  roomId: string,
  callId: string,
): Promise<void> {
  try {
    await (client.sendEvent as SendCustomMatrixEvent)(roomId, VOICE_CALL_EVENT_TYPE, {
      call_id: callId,
      action: "hangup",
    });
  } catch {
    // Best-effort — callee may have already left.
  }
}

export function memberDisplayName(
  client: MatrixClient,
  roomId: string,
  matrixUserId: string,
): string {
  const member = client.getRoom(roomId)?.getMember(matrixUserId);
  const name = member?.name?.trim();
  if (name && name !== matrixUserId) return name;
  return matrixUserId;
}

export function installVoiceCallListener(
  client: MatrixClient,
  myMatrixUserId: string,
  handlers: {
    onInvite: (payload: { callId: string; matrixRoomId: string; peerName: string }) => void;
    onHangup: (payload: { callId: string; matrixRoomId: string }) => void;
  },
): () => void {
  const onTimeline = (event: MatrixEvent) => {
    if (event.getType() !== VOICE_CALL_EVENT_TYPE) return;
    const sender = event.getSender();
    if (!sender || sender === myMatrixUserId) return;
    const roomId = event.getRoomId();
    if (!roomId) return;
    const signal = parseVoiceCallSignal(event.getContent());
    if (!signal) return;
    if (signal.action === "invite") {
      handlers.onInvite({
        callId: signal.call_id,
        matrixRoomId: roomId,
        peerName: memberDisplayName(client, roomId, sender),
      });
      return;
    }
    handlers.onHangup({ callId: signal.call_id, matrixRoomId: roomId });
  };

  client.on(RoomEvent.Timeline, onTimeline);
  return () => {
    client.removeListener(RoomEvent.Timeline, onTimeline);
  };
}

export function isDuplicateVoiceInvite(
  current:
    | { status: "incoming" | "active"; callId: string; matrixRoomId: string }
    | { status: "idle" },
  next: { callId: string; matrixRoomId: string },
): boolean {
  if (current.status === "idle") return false;
  return current.callId === next.callId && current.matrixRoomId === next.matrixRoomId;
}
