"use client";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { MeetingRoomView } from "@uniwork/views/meetings/room-view";
import { useNavigation } from "@uniwork/views/navigation";

export default function MeetingRoomPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { workspace } = useWorkspace();
  const { replace } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return <MeetingRoomView meetingId={meetingId} onLeave={() => replace(ws.meeting(meetingId))} />;
}
