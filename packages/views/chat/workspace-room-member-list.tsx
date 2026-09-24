"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRoomMemberRecord } from "@uniwork/core/api/endpoints/chat";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import type { Member } from "@uniwork/core/types/workspace";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { initialOf } from "./chat-initials";
import { ChatRoomMemberActions } from "./chat-room-member-actions";
import {
  canDemoteChatMember,
  canMuteChatMember,
  canPromoteChatMember,
  canUnmuteChatMember,
} from "./chat-room-moderation-utils";
import { foldedIncludes } from "./chat-search-fold";
import { ChatMemberRow } from "./chat-settings-ui";
import { useRoomMemberModeration } from "./use-room-member-moderation";

/** Rows rendered per step: a 1,000-person workspace never mounts 1,000 menus at once. */
const WORKSPACE_MEMBER_PAGE = 50;
/** Below this a list is read at a glance and a search box is only noise. */
const SEARCH_FROM = 9;

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
}: {
  workspaceId: string;
  roomId: string;
  members: ChatRoomMemberRecord[];
  workspaceMembers: Member[];
  currentUserId: string;
  youLabel: string;
  isModerator: boolean;
}) {
  const { t } = useTranslation();
  const { decideRemove } = useWorkspacePermissions(workspaceId);
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
        <div className="px-4 pb-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              aria-label={t("chat.workspace_members_search")}
              placeholder={t("chat.workspace_members_search")}
              className="pl-8"
              onChange={(event) => {
                setQuery(event.target.value);
                setVisible(WORKSPACE_MEMBER_PAGE);
              }}
            />
          </div>
        </div>
      ) : null}
      {matches.length === 0 ? (
        <p role="status" className="px-4 py-3 text-caption text-muted-foreground">
          {t("chat.workspace_members_no_match", { query: query.trim() })}
        </p>
      ) : (
        <ul>
          {shown.map(({ member, isSelf, label }) => {
            const wsMember = wsMemberByUserId.get(member.user_id);
            const detail =
              member.role === "admin"
                ? t("chat.room_role_admin")
                : member.send_restricted
                  ? t("chat.room_role_muted")
                  : wsMember?.role === "owner"
                    ? t("chat.workspace_role_owner")
                    : member.email;
            return (
              <ChatMemberRow
                key={member.user_id}
                avatar={<ActorAvatar name={label} initials={initialOf(label)} size="lg" />}
                name={label}
                detail={detail}
                actions={
                  !isSelf && isModerator ? (
                    <ChatRoomMemberActions
                      label={label}
                      canPromote={canPromoteChatMember(member, isModerator)}
                      canDemote={canDemoteChatMember(member, currentUserId, isModerator)}
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
            size="sm"
            onClick={() => setVisible((count) => count + WORKSPACE_MEMBER_PAGE)}
          >
            {t("chat.workspace_members_show_more", { count: Math.min(remaining, WORKSPACE_MEMBER_PAGE), remaining })}
          </Button>
        </div>
      ) : null}
      {moderation.confirmDialog}
    </>
  );
}
