"use client";
import { useParams, useRouter } from "next/navigation";
import { MeetingRoomView } from "@uniwork/views/meetings/room-view";

export default function MeetingRoomPage() {
  const router = useRouter();
  const { workspaceSlug, meetingId } = useParams<{ workspaceSlug: string; meetingId: string }>();
  return (
    <MeetingRoomView
      meetingId={meetingId}
      onLeave={() => router.replace(`/${workspaceSlug}/meetings/${meetingId}`)}
    />
  );
}
