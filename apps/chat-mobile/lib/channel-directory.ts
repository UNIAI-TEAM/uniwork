// The channel directory (MobChannels board): the channels one can join and,
// marked "Đã tham gia" in the same list, the public channels one is already in
// (never the workspace's own room), each once, found by name or topic with
// Vietnamese folding, A–Z.
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { foldedIncludes } from "@uniwork/core/chat/search-fold";

export function channelDirectory(discoverable: readonly ChatRoomRecord[], mine: readonly ChatRoomRecord[], query: string): ChatRoomRecord[] {
  const byId = new Map<string, ChatRoomRecord>();
  for (const channel of [...discoverable, ...mine.filter((c) => c.kind === "channel" && c.visibility !== "private" && !c.is_default)]) {
    if (!byId.has(channel.id)) byId.set(channel.id, channel);
  }
  return [...byId.values()]
    .filter((c) => foldedIncludes(c.name, query) || foldedIncludes(c.topic ?? "", query))
    .sort((a, b) => a.name.localeCompare(b.name));
}
