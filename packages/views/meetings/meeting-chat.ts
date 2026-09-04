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

function persistedToItem(msg: PersistedChatMessage, localIdentity: string): MeetingChatItem {
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

function isNearDuplicate(a: MeetingChatItem, b: MeetingChatItem): boolean {
  return (
    a.fromIdentity === b.fromIdentity &&
    a.message === b.message &&
    Math.abs(a.timestamp - b.timestamp) < 10_000
  );
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

/** Merge API history with ephemeral LiveKit messages, newest last. */
export function mergeChatMessages(
  persisted: PersistedChatMessage[],
  live: LiveChatMessage[],
  localIdentity: string,
): MeetingChatItem[] {
  const fromApi = persisted.map((msg) => persistedToItem(msg, localIdentity));
  const extras = live.filter(
    (msg) => !fromApi.some((saved) => saved.id === msg.id || isNearDuplicate(saved, msg)),
  );
  return [...fromApi, ...extras].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}
