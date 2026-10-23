"use client";
import { ChatPageView } from "@uniwork/views/chat/chat-page-view";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useIsUniChatHost } from "@/platform/desktop-host";
import { useDocumentsDesktopOpen } from "@/platform/office-frame/desktop-open-props";

export default function ChatPage() {
  const { workspace, user } = useWorkspace();
  // Feeds the document card's "Chỉnh sửa trong UniWork Office" entry. The
  // UniChat shell cannot launch the Office app (its navigation guard and
  // openExternal take https only, UNI-2012 D7), so there the entry hides; the
  // card's page entries leave the shell through its navigation policy.
  const desktopOpen = useDocumentsDesktopOpen(workspace.organization_id);
  const chatOnly = useIsUniChatHost();
  return <ChatPageView workspaceId={workspace.id} currentUserId={user.id} desktopOpen={chatOnly ? undefined : desktopOpen} />;
}
