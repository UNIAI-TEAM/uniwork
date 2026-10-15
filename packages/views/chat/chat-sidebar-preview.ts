import { resolveChatNicknameForUser } from "@uniwork/core/chat/contacts-store";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";
import { describeChatMediaBody, type ChatMediaLabels } from "./chat-expression-utils";

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
    mediaLabels?: ChatMediaLabels;
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
  const media = options.mediaLabels ? describeChatMediaBody(preview.body, options.mediaLabels) : null;
  const body = media ?? deserializeMessageBodyToComposerDraft(preview.body).trim();
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

type SidebarTimeFormat = "time" | "weekday" | "date";

const SIDEBAR_TIME_OPTIONS: Record<SidebarTimeFormat, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  weekday: { weekday: "short" },
  date: { month: "numeric", day: "numeric", year: "numeric" },
};

/*
 * Building an Intl.DateTimeFormat is the expensive part of toLocale*String,
 * and the sidebar formats one time per row on every render. One formatter per
 * locale and shape is enough.
 */
const sidebarTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function sidebarTimeFormatter(locale: string | undefined, format: SidebarTimeFormat): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${format}`;
  let formatter = sidebarTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, SIDEBAR_TIME_OPTIONS[format]);
    sidebarTimeFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatChatSidebarTime(
  iso: string | undefined,
  options: { now?: Date; yesterdayLabel: string; locale?: string },
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
    return sidebarTimeFormatter(options.locale, "time").format(date);
  }
  if (dayDiff === 1) {
    return options.yesterdayLabel;
  }
  if (dayDiff < 7) {
    return sidebarTimeFormatter(options.locale, "weekday").format(date);
  }
  return sidebarTimeFormatter(options.locale, "date").format(date);
}

function sameUserId(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

/** A display name that is the person's id is not a name. */
function humanLabel(label: string, userId: string): string {
  const name = label.trim();
  if (!name || sameUserId(name, userId)) return "";
  return name;
}

/**
 * The room list's last-message name is the account's display name, which can
 * be empty. The sidebar then printed the user id. Fill that gap from the
 * names the chat page already knows, and rewrite a mention whose stored
 * label is that id.
 */
export function applyKnownPeopleToRoomPreviews(
  previews: Record<string, ChatRoomPreview>,
  people: ReadonlyArray<{ user_id: string; display_name: string }>,
): Record<string, ChatRoomPreview> {
  const names = new Map<string, string>();
  for (const person of people) {
    const name = humanLabel(person.display_name, person.user_id);
    if (!person.user_id.trim() || !name) continue;
    names.set(person.user_id.trim().toUpperCase(), name);
  }
  if (names.size === 0) return previews;

  const out: Record<string, ChatRoomPreview> = {};
  for (const [roomId, preview] of Object.entries(previews)) {
    const known = names.get(preview.senderId.trim().toUpperCase());
    out[roomId] = {
      ...preview,
      senderName: known || preview.senderName,
      body: rewriteMentionIds(preview.body, names),
    };
  }
  return out;
}

function rewriteMentionIds(body: string, names: ReadonlyMap<string, string>): string {
  const withTokens = body.replace(
    /\[@([^\]]*)\]\(mention:\/\/member\/([^)]+)\)/g,
    (token, label: string, id: string) => {
      const known = names.get(id.trim().toUpperCase());
      if (!known || humanLabel(label, id)) return token;
      return `[@${known}](mention://member/${id})`;
    },
  );
  return withTokens.replace(
    /(^|[^\w[])@([0-9A-HJKMNP-TV-Z]{26})\b/gi,
    (token, prefix: string, id: string) => {
      const known = names.get(id.toUpperCase());
      return known ? `${prefix}@${known}` : token;
    },
  );
}

export function compareRoomPreviewRecency(
  left?: ChatRoomPreview | null,
  right?: ChatRoomPreview | null,
): number {
  const leftTs = left?.createdAt ? Date.parse(left.createdAt) : 0;
  const rightTs = right?.createdAt ? Date.parse(right.createdAt) : 0;
  return rightTs - leftTs;
}
