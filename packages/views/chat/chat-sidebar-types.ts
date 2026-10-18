import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import type { MemberAvatarUrlMap } from "./chat-member-avatar";

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
  onOpenFollowUps?: () => void;
  /** "Bắt kịp nhanh" at the top of the list: opens the busiest room and its catch-up brief. Absent when UNI cannot summarise. */
  onQuickCatchUp?: (target: ChatSidebarTarget, roomId: string) => void;
  onCreateGroup?: (members: ChatContact[], name: string) => void;
  creatingGroup?: boolean;
  createGroupOpen?: boolean;
  onCreateGroupOpenChange?: (open: boolean) => void;
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
  /** Workspace member avatars keyed by normalized user id. */
  memberAvatarByUserId?: MemberAvatarUrlMap;
  /** People the page can already name, so a typing row does not print an id. */
  knownPeople?: ReadonlyArray<{ user_id: string; display_name: string }>;
}
