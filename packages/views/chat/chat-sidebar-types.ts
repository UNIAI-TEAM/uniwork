import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { Workspace } from "@uniwork/core/types";
import type { ChatRoomPreview } from "./chat-sidebar-preview";

export type ChatSidebarTarget =
  | { kind: "workspace" }
  | { kind: "dm"; contact: ChatContact }
  | { kind: "group"; group: GroupChat }
  | { kind: "channel"; channel: ChatRoomRecord };

export interface ChatSidebarProps {
  currentUserId: string;
  workspaceId: string;
  target: ChatSidebarTarget;
  onTargetChange: (target: ChatSidebarTarget) => void;
  contacts: ChatContact[];
  groups: GroupChat[];
  channels?: ChatRoomRecord[];
  workHubEnabled?: boolean;
  onOpenFollowUps?: () => void;
  onCreateGroup?: (members: ChatContact[], name: string) => void;
  creatingGroup?: boolean;
  createGroupOpen?: boolean;
  onCreateGroupOpenChange?: (open: boolean) => void;
  /** A pending invitation was accepted; `workspace` is null for an organization-only invite. */
  onJoinedWorkspace?: (workspace: Workspace | null) => void;
  workspaceRoomId?: string | null;
  unreadByRoomId?: Record<string, number>;
  mentionUnreadByRoomId?: Record<string, number>;
  roomPreviewsByRoomId?: Record<string, ChatRoomPreview>;
  unreadBadgesReady?: boolean;
  nicknamesByUserId?: Record<string, string>;
  embedded?: boolean;
  /** Rooms have not arrived yet: the list shows its loading shape, not "empty". */
  loading?: boolean;
  /** Rooms failed to load: the list says so and offers `onRetry` instead of loading forever. */
  loadError?: boolean;
  onRetry?: () => void;
  /** The workspace room's display name; defaults to the generic "Chung". */
  workspaceRoomTitle?: string;
  /** Hides the list on desktop; the conversation header offers the way back. */
  onCollapse?: () => void;
}
