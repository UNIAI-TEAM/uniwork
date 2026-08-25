"use client";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { MeetingsPageView } from "@uniwork/views/meetings/meetings-page-view";
import { useNavigation } from "@uniwork/views/navigation";

export default function MeetingsPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return <MeetingsPageView workspaceId={workspace.id} onOpen={(id) => push(ws.meeting(id))} />;
}
