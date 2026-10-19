"use client";
import { ChatPageView } from "@uniwork/views/chat/chat-page-view";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useDocumentsDesktopOpen } from "@/platform/office-frame/desktop-open-props";

export default function ChatPage() {
  const { workspace, user } = useWorkspace();
  // UNI-1966: feeds the document card's "Mở bằng UniWork Office" action.
  const desktopOpen = useDocumentsDesktopOpen(workspace.organization_id);
  return <ChatPageView workspaceId={workspace.id} currentUserId={user.id} desktopOpen={desktopOpen} />;
}
