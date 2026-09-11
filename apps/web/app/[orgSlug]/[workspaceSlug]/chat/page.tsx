"use client";
import { ChatPageView } from "@uniwork/views/chat/chat-page-view";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";

export default function ChatPage() {
  const { workspace, user } = useWorkspace();
  return <ChatPageView workspaceId={workspace.id} currentUserId={user.id} />;
}
