import type { ChatSidebarTarget } from "./chat-sidebar-types";

/**
 * Which conversation a composer draft belongs to. Keyed by the conversation,
 * not the room id, because a new DM has no room until its first message.
 */
export function chatComposerDraftKey(workspaceId: string, target: ChatSidebarTarget): string {
  switch (target.kind) {
    case "dm":
      return `${workspaceId}:dm:${target.contact.user_id}`;
    case "group":
      return `${workspaceId}:group:${target.group.id}`;
    case "channel":
      return `${workspaceId}:channel:${target.channel.id}`;
    default:
      return `${workspaceId}:workspace`;
  }
}
