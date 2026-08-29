"use client";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { MeetingDetailView } from "@uniwork/views/meetings/meeting-detail-view";
import { useNavigation } from "@uniwork/views/navigation";

export default function MeetingDetailPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return (
    <MeetingDetailView
      workspaceId={workspace.id}
      meetingId={meetingId}
      onJoin={() => push(ws.room(meetingId))}
    />
  );
}
