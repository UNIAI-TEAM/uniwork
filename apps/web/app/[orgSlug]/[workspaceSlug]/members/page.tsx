"use client";
import { MembersView } from "@uniwork/views/workspace/members-view";
import { useCurrentWorkspace } from "../layout";

export default function MembersPage() {
  const { workspace } = useCurrentWorkspace();
  return <MembersView workspaceId={workspace.id} />;
}
