/** Must stay in sync with server/internal/meetings/room_name.go */
export function liveKitVoiceRoomFromMatrixRoom(matrixRoomId: string): string {
  const prefix = "uw-voice-";
  const trimmed = matrixRoomId.trim();
  if (!trimmed) return `${prefix}unknown`;
  let safe = "";
  for (const ch of trimmed) {
    if (/[a-zA-Z0-9_-]/.test(ch)) safe += ch;
    else safe += "-";
  }
  const out = prefix + safe;
  return out.length > 240 ? out.slice(0, 240) : out;
}

export function createVoiceCallId(): string {
  return crypto.randomUUID();
}
