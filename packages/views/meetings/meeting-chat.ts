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
