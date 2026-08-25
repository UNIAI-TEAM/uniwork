"use client";
import { useParams, useRouter } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { MeetingDetailView } from "@uniwork/views/meetings/meeting-detail-view";
import { useCurrentWorkspace } from "../../layout";

export default function MeetingDetailPage() {
  const router = useRouter();
  const { orgSlug, workspaceSlug, meetingId } = useParams<{ orgSlug: string; workspaceSlug: string; meetingId: string }>();
  const { workspace } = useCurrentWorkspace();
  const ws = paths.workspace(orgSlug, workspaceSlug);
  return (
    <MeetingDetailView
      workspaceId={workspace.id}
      meetingId={meetingId}
      onJoin={() => router.push(ws.room(meetingId))}
      onDeleted={() => router.replace(ws.meetings())}
    />
  );
}
