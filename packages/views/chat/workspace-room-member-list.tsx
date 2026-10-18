"use client";

import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRoomMemberRecord } from "@uniwork/core/api/endpoints/chat";
import { useCurrentMember, useWorkspacePermissions } from "@uniwork/core/permissions";
import type { Member } from "@uniwork/core/types/workspace";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { memberAvatarUrl } from "./chat-member-avatar";
import { ChatRoomMemberActions } from "./chat-room-member-actions";
import {
  canDemoteChatMember,
  canMuteChatMember,
  canPromoteChatMember,
  canUnmuteChatMember,
} from "./chat-room-moderation-utils";
import { foldedIncludes } from "./chat-search-fold";
import type { ChatMemberMessageTarget } from "./chat-member-profile";
import { ChatMemberFace, ChatMemberRow, type ChatMemberDetailTone } from "./chat-settings-ui";
import { useRoomMemberModeration } from "./use-room-member-moderation";

/** Rows rendered per step: a 1,000-person workspace never mounts 1,000 menus at once. */
const WORKSPACE_MEMBER_PAGE = 50;
/** Below this a list is read at a glance and a search box is only noise. */
const SEARCH_FROM = 9;
/** This list only ever shows the workspace room, which the moderation rules treat as one. */
const WORKSPACE_ROOM = { kind: "workspace" } as const;

/**
 * The workspace room's members: searchable (accent-insensitive), shown a page
 * at a time. Removing someone here removes them from the workspace — the
 * confirmation says exactly that.
 */
export function WorkspaceRoomMemberList({
  workspaceId,
  roomId,
  members,
  workspaceMembers,
  currentUserId,
  youLabel,
  isModerator,
  onMessage,
}: {
  workspaceId: string;
  roomId: string;
  members: ChatRoomMemberRecord[];
  workspaceMembers: Member[];
  currentUserId: string;
  youLabel: string;
  isModerator: boolean;
  onMessage?: (member: ChatMemberMessageTarget) => void;
}) {
  const { t } = useTranslation();
  const { decideRemove } = useWorkspacePermissions(workspaceId);
  const wsRole = useCurrentMember(workspaceId).role;
  const moderation = useRoomMemberModeration({ workspaceId, roomId });
  const workspaceName = useOptionalWorkspace()?.workspace.name?.trim();
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(WORKSPACE_MEMBER_PAGE);

  const wsMemberByUserId = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.user_id, member])),
    [workspaceMembers],
  );

  const rows = useMemo(
    () =>
      members.map((member) => {
        const isSelf = member.user_id === currentUserId;
        const label = isSelf ? youLabel : member.display_name?.trim() || member.email || member.user_id;
        return { member, isSelf, label };
      }),
    [members, currentUserId, youLabel],
  );
  const matches = useMemo(
    () => (query.trim() ? rows.filter((row) => foldedIncludes(`${row.label} ${row.member.email}`, query)) : rows),
    [query, rows],
  );
  const shown = matches.slice(0, visible);
  const remaining = matches.length - shown.length;

  return (
    <>
      {members.length >= SEARCH_FROM ? (
        <div className="px-5 pb-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              aria-label={t("chat.workspace_members_search")}
              placeholder={t("chat.workspace_members_search")}
              className="h-11 bg-muted pl-10"
              onChange={(event) => {
                setQuery(event.target.value);
                setVisible(WORKSPACE_MEMBER_PAGE);
              }}
            />
          </div>
        </div>
      ) : null}
      {matches.length === 0 ? (
        <p role="status" className="px-5 py-3 text-caption text-muted-foreground">
          {t("chat.workspace_members_no_match", { query: query.trim() })}
        </p>
      ) : (
        <ul>
          {shown.map(({ member, isSelf, label }) => {
            const wsMember = wsMemberByUserId.get(member.user_id);
            const detailTone: ChatMemberDetailTone | undefined =
              member.role === "admin"
                ? "admin"
                : member.send_restricted
                  ? "restricted"
                  : wsMember?.role === "owner"
                    ? "owner"
                    : undefined;
            const detail =
              detailTone === "admin"
                ? t("chat.room_role_admin")
                : detailTone === "restricted"
                  ? t("chat.room_role_muted")
                  : detailTone === "owner"
                    ? t("chat.workspace_role_owner")
                    : member.email;
            return (
              <ChatMemberRow
                key={member.user_id}
                avatar={
                  <ChatMemberFace
                    userId={member.user_id}
                    name={member.display_name?.trim() || label}
                    avatarUrl={memberAvatarUrl(wsMember?.avatar_url)}
                  />
                }
                name={label}
                detail={detail}
                detailTone={detailTone}
                profile={{
                  userId: member.user_id,
                  email: member.email,
                  avatarUrl: memberAvatarUrl(wsMember?.avatar_url),
                  onMessage:
                    !isSelf && onMessage
                      ? () =>
                          onMessage({
                            user_id: member.user_id,
                            email: member.email,
                            display_name: member.display_name?.trim() || member.email,
                          })
                      : undefined,
                }}
                actions={
                  !isSelf && isModerator ? (
                    <ChatRoomMemberActions
                      label={label}
                      canPromote={canPromoteChatMember(member, isModerator)}
                      canDemote={
                        canDemoteChatMember(member, currentUserId, members, wsRole, WORKSPACE_ROOM) &&
                        wsMember?.role !== "owner"
                      }
                      canMute={canMuteChatMember(member, isModerator)}
                      canUnmute={canUnmuteChatMember(member, isModerator)}
                      canKick={wsMember ? decideRemove(wsMember).allowed && member.role !== "admin" : false}
                      kickLabel={t("chat.remove_from_workspace", { name: label })}
                      busy={moderation.busyUserId === member.user_id}
                      onPromote={() => moderation.promote(member.user_id)}
                      onDemote={() => moderation.demote(member.user_id)}
                      onMute={() => moderation.mute(member.user_id)}
                      onUnmute={() => moderation.unmute(member.user_id)}
                      onKick={() =>
                        moderation.requestRemove(member.user_id, label, t("workspace.removeConfirm", { name: label }), {
                          description: workspaceName
                            ? t("chat.remove_workspace_member_description", { name: label, workspace: workspaceName })
                            : t("chat.remove_workspace_member_description_generic", { name: label }),
                          confirmLabel: t("chat.remove_workspace_member_confirm"),
                        })
                      }
                    />
                  ) : null
                }
              />
            );
          })}
        </ul>
      )}
      {remaining > 0 ? (
        <div className="px-4 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="h-10 rounded-full px-3.5 font-semibold text-brand hover:text-brand"
            onClick={() => setVisible((count) => count + WORKSPACE_MEMBER_PAGE)}
          >
            <ChevronDown aria-hidden />
            {t("chat.workspace_members_show_more", { count: Math.min(remaining, WORKSPACE_MEMBER_PAGE), remaining })}
          </Button>
        </div>
      ) : null}
      {moderation.confirmDialog}
    </>
  );
}
