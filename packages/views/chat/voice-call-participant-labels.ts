import type { ChatMessage } from "./chat-messages";

export function formatVoiceCallParticipantLabels(
  message: ChatMessage,
  currentUserId: string,
  youLabel: string,
): string {
  const participants = message.voiceCall?.participants;
  if (!participants?.length) return "";

  const labels = participants.map((p) => {
    if (p.user_id === currentUserId) return youLabel;
    const name = p.display_name.trim();
    return name || p.user_id;
  });

  return labels.join(", ");
}
