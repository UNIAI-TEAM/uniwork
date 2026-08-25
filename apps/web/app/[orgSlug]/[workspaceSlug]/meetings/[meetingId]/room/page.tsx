"use client";
import { useParams, useRouter } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { MeetingRoomView } from "@uniwork/views/meetings/room-view";

export default function MeetingRoomPage() {
  const router = useRouter();
  const { orgSlug, workspaceSlug, meetingId } = useParams<{ orgSlug: string; workspaceSlug: string; meetingId: string }>();
  return <MeetingRoomView meetingId={meetingId} onLeave={() => router.replace(paths.workspace(orgSlug, workspaceSlug).meeting(meetingId))} />;
}
