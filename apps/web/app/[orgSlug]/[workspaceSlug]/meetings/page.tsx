"use client";
import { useParams, useRouter } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { MeetingsPageView } from "@uniwork/views/meetings/meetings-page-view";
import { useCurrentWorkspace } from "../layout";

export default function MeetingsPage() {
  const router = useRouter();
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <MeetingsPageView workspaceId={workspace.id} onOpen={(id) => router.push(paths.workspace(orgSlug, workspaceSlug).meeting(id))} />
  );
}
