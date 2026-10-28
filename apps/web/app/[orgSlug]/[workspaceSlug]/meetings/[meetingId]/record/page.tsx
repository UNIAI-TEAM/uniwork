"use client";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { MeetingRecordView } from "@uniwork/views/meetings/record/record-view";
import { useNavigation } from "@uniwork/views/navigation";

export default function MeetingRecordPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { workspace } = useWorkspace();
  const { replace, searchParams } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return (
    <MeetingRecordView
      meetingId={meetingId}
      workspaceId={workspace.id}
      meetingsHref={ws.meetings()}
      workspaceLabel={workspace.name}
      send={searchParams.get("send") === "1"}
      onBack={() => replace(ws.meeting(meetingId))}
      onSent={() => replace(ws.meeting(meetingId))}
    />
  );
}
