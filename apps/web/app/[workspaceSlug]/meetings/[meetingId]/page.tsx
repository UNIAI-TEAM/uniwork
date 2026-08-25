"use client";
import { useParams, useRouter } from "next/navigation";
import { MeetingDetailView } from "@uniwork/views/meetings/meeting-detail-view";
import { useCurrentWorkspace } from "../../layout";

export default function MeetingDetailPage() {
  const router = useRouter();
  const { workspaceSlug, meetingId } = useParams<{ workspaceSlug: string; meetingId: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <MeetingDetailView
      workspaceId={workspace.id}
      meetingId={meetingId}
      onJoin={() => router.push(`/${workspaceSlug}/meetings/${meetingId}/room`)}
      onDeleted={() => router.replace(`/${workspaceSlug}/meetings`)}
    />
  );
}
