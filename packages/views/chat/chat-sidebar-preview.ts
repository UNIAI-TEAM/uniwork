import { resolveChatNicknameForUser } from "@uniwork/core/chat/contacts-store";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";

export type ChatRoomPreview = {
  body: string;
  kind: string;
  senderId: string;
  senderName: string;
  createdAt: string;
};

export function formatChatSidebarPreviewText(
  preview: ChatRoomPreview | null | undefined,
  options: {
    currentUserId: string;
    isGroup: boolean;
    youLabel: string;
    voiceCallLabel: string;
    voiceMessageLabel?: string;
    fileMessageLabel?: string;
    nicknamesByUserId?: Readonly<Record<string, string>>;
  },
): string | null {
  if (!preview) return null;
  if (preview.kind === "voice_call_log") {
    return options.voiceCallLabel;
  }
  if (preview.kind === "voice") {
    return options.voiceMessageLabel ?? options.voiceCallLabel;
  }
  if (preview.kind === "file") {
    const name = preview.body.trim();
    return name || options.fileMessageLabel || null;
  }
  const body = deserializeMessageBodyToComposerDraft(preview.body).trim();
  if (!body) return null;
  if (options.isGroup) {
    const isSelf =
      preview.senderId.trim().toUpperCase() === options.currentUserId.trim().toUpperCase();
    const selfNickname = resolveChatNicknameForUser(options.nicknamesByUserId, options.currentUserId);
    const peerNickname = resolveChatNicknameForUser(options.nicknamesByUserId, preview.senderId);
    const sender = isSelf
      ? selfNickname || options.youLabel
      : peerNickname || preview.senderName.trim() || preview.senderId;
    return `${sender}: ${body}`;
  }
  return body;
}

export function formatChatSidebarTime(
  iso: string | undefined,
  options: { now?: Date; yesterdayLabel: string },
): string | null {
  if (!iso?.trim()) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const now = options.now ?? new Date();

  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const dayDiff =
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / (24 * 60 * 60 * 1000);

  if (dayDiff === 0) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (dayDiff === 1) {
    return options.yesterdayLabel;
  }
  if (dayDiff < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" });
}

export function compareRoomPreviewRecency(
  left?: ChatRoomPreview | null,
  right?: ChatRoomPreview | null,
): number {
  const leftTs = left?.createdAt ? Date.parse(left.createdAt) : 0;
  const rightTs = right?.createdAt ? Date.parse(right.createdAt) : 0;
  return rightTs - leftTs;
}
