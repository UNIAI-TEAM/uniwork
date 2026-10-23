export type MeetingChatItem = {
  id: string;
  fromIdentity: string;
  fromName: string;
  isLocal: boolean;
  message: string;
  timestamp: number;
};

export type MeetingChatGroup = {
  fromIdentity: string;
  fromName: string;
  isLocal: boolean;
  items: MeetingChatItem[];
};

export type PersistedChatMessage = {
  id: string;
  sender_identity?: string;
  sender_name?: string;
  message: string;
  sent_at: string;
};

export type LiveChatMessage = {
  id: string;
  fromIdentity: string;
  fromName: string;
  isLocal: boolean;
  message: string;
  timestamp: number;
};

/** Consecutive messages from the same identity share one header. */
export function groupChatMessages(items: MeetingChatItem[]): MeetingChatGroup[] {
  return items.reduce<MeetingChatGroup[]>((groups, item) => {
    const last = groups[groups.length - 1];
    if (last && last.fromIdentity === item.fromIdentity) {
      return [...groups.slice(0, -1), { ...last, items: [...last.items, item] }];
    }
    return [
      ...groups,
      {
        fromIdentity: item.fromIdentity,
        fromName: item.fromName,
        isLocal: item.isLocal,
        items: [item],
      },
    ];
  }, []);
}

function toChatItem(msg: PersistedChatMessage, localIdentity: string): MeetingChatItem {
  const fromIdentity = msg.sender_identity ?? "";
  return {
    id: msg.id,
    fromIdentity,
    fromName: msg.sender_name || fromIdentity,
    isLocal: !!localIdentity && fromIdentity === localIdentity,
    message: msg.message,
    timestamp: Date.parse(msg.sent_at) || 0,
  };
}

/** Drop duplicate rows by id and near-identical sends (double POST guard). */
export function dedupePersistedChatMessages(
  messages: PersistedChatMessage[],
): PersistedChatMessage[] {
  const byId = new Map<string, PersistedChatMessage>();
  for (const msg of messages) {
    if (msg.id && !byId.has(msg.id)) byId.set(msg.id, msg);
  }
  const sorted = [...byId.values()].sort(
    (a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || a.id.localeCompare(b.id),
  );
  const byFingerprint = new Map<string, PersistedChatMessage>();
  for (const msg of sorted) {
    const ts = Date.parse(msg.sent_at) || 0;
    const bucket = Math.floor(ts / 2000);
    const key = `${msg.sender_identity ?? ""}\0${msg.message}\0${bucket}`;
    if (!byFingerprint.has(key)) byFingerprint.set(key, msg);
  }
  return [...byFingerprint.values()].sort(
    (a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || a.id.localeCompare(b.id),
  );
}

/** Map Postgres chat rows to UI items (single source of truth for in-room chat). */
export function toChatItems(
  persisted: PersistedChatMessage[],
  localIdentity: string,
): MeetingChatItem[] {
  return dedupePersistedChatMessages(persisted)
    .map((msg) => toChatItem(msg, localIdentity))
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/** How far the reader has seen: a row's time and id, or the start of the room. */
export type ChatWatermark = { at: number; id: string };

/** The watermark at the newest row (rows in reading order), or the start when there is none. */
export function chatWatermark(rows: PersistedChatMessage[]): ChatWatermark {
  const last = rows[rows.length - 1];
  return last ? { at: Date.parse(last.sent_at) || 0, id: last.id } : { at: -Infinity, id: "" };
}

/**
 * Messages from others after the watermark, oldest first. Walks back from
 * the end only as far as the watermark, so the unread badge costs what is
 * unread, not the whole history - and still holds when a refetch replaced
 * the rows the watermark was taken from.
 */
export function unreadChatSince(
  rows: PersistedChatMessage[],
  mark: ChatWatermark,
  localIdentity: string,
): MeetingChatItem[] {
  const out: MeetingChatItem[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    const at = Date.parse(row.sent_at) || 0;
    if (at < mark.at || (at === mark.at && row.id.localeCompare(mark.id) <= 0)) break;
    const item = toChatItem(row, localIdentity);
    if (!item.isLocal) out.push(item);
  }
  return out.reverse();
}

/** Map ephemeral LiveKit messages for offline / guest fallback. */
export function toEphemeralChatItems(live: LiveChatMessage[]): MeetingChatItem[] {
  return live
    .map((msg) => ({
      id: msg.id,
      fromIdentity: msg.fromIdentity,
      fromName: msg.fromName,
      isLocal: msg.isLocal,
      message: msg.message,
      timestamp: msg.timestamp,
    }))
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/** Accumulate LiveKit chat across reconnects (useChat clears on disconnect). */
export function mergeLiveChatArchive(
  archive: LiveChatMessage[],
  incoming: LiveChatMessage[],
): LiveChatMessage[] {
  const map = new Map<string, LiveChatMessage>();
  for (const msg of archive) {
    map.set(msg.id, msg);
  }
  for (const msg of incoming) {
    map.set(msg.id, msg);
  }
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}
