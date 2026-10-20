"use client";

import { useMemo } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import type { Member } from "@uniwork/core/types/workspace";
import { applySelfAvatarToNameContext, buildMemberAvatarUrlMap, withSelfAvatarFromUser } from "./chat-member-avatar";
import { buildChatNameContext } from "./chat-page-utils";

type NameContextArgs = Parameters<typeof buildChatNameContext>;

/**
 * Whom the chat page can name and picture: the workspace members' avatars and
 * the open room's people, my own photo taken from my session so it shows
 * before the member list catches up.
 */
export function useChatPageNames(
  contacts: NameContextArgs[0],
  activeContact: NameContextArgs[1],
  activeGroup: NameContextArgs[2],
  groupMemberProfiles: NameContextArgs[3],
  workspaceMembers: Member[],
  nicknamesByUserId: NameContextArgs[5],
) {
  const authUser = useAuthStore((s) => (s.status === "authed" ? s.user : null));
  const memberAvatarByUserId = useMemo(
    () => withSelfAvatarFromUser(buildMemberAvatarUrlMap(workspaceMembers), authUser?.id, authUser?.avatar_url),
    [workspaceMembers, authUser?.avatar_url, authUser?.id],
  );
  const nameContext = useMemo(
    () =>
      applySelfAvatarToNameContext(
        buildChatNameContext(contacts, activeContact, activeGroup, groupMemberProfiles, workspaceMembers, nicknamesByUserId),
        authUser?.id,
        authUser?.avatar_url,
      ),
    [contacts, activeContact, activeGroup, groupMemberProfiles, workspaceMembers, nicknamesByUserId, authUser?.avatar_url, authUser?.id],
  );
  return { memberAvatarByUserId, nameContext };
}
