"use client";

import { useCallback } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";

/**
 * "Nhắn tin" from the directory: go to Chat with `?dm=<userId>`, which opens
 * the one-to-one conversation there (see chat/use-chat-dm-deep-link). Chat
 * owns resolving the room and saying why it could not, so the directory only
 * says who.
 */
export function useStartChat(): (userId: string) => void {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  return useCallback(
    (userId: string) => {
      const chat = paths.workspace(workspace.organization_slug, workspace.slug).chat();
      push(`${chat}?dm=${encodeURIComponent(userId)}`);
    },
    [push, workspace.organization_slug, workspace.slug],
  );
}
