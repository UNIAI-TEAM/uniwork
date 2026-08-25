"use client";
import { useParams, useRouter } from "next/navigation";
import { MeetingsPageView } from "@uniwork/views/meetings/meetings-page-view";
import { useCurrentWorkspace } from "../layout";

export default function MeetingsPage() {
  const router = useRouter();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <MeetingsPageView
      workspaceId={workspace.id}
      onOpen={(id) => router.push(`/${workspaceSlug}/meetings/${id}`)}
    />
  );
}
