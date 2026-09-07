import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomPreview } from "./chat-sidebar-preview";

export type ChatSidebarTarget =
  | { kind: "workspace" }
  | { kind: "dm"; contact: ChatContact }
  | { kind: "group"; group: GroupChat };

export interface ChatSidebarProps {
  currentUserId: string;
  workspaceId: string;
  target: ChatSidebarTarget;
  onTargetChange: (target: ChatSidebarTarget) => void;
  contacts: ChatContact[];
  groups: GroupChat[];
  onCreateGroup?: (members: ChatContact[], name: string) => void;
  creatingGroup?: boolean;
  createGroupOpen?: boolean;
  onCreateGroupOpenChange?: (open: boolean) => void;
  onJoinedWorkspace?: () => void;
  workspaceRoomId?: string | null;
  unreadByRoomId?: Record<string, number>;
  mentionUnreadByRoomId?: Record<string, number>;
  roomPreviewsByRoomId?: Record<string, ChatRoomPreview>;
  unreadBadgesReady?: boolean;
  nicknamesByUserId?: Record<string, string>;
  embedded?: boolean;
}
