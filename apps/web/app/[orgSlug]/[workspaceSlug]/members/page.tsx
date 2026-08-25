"use client";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { MembersView } from "@uniwork/views/workspace/members-view";

export default function MembersPage() {
  const { workspace } = useWorkspace();
  return <MembersView workspaceId={workspace.id} />;
}
