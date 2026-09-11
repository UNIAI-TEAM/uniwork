"use client";

import { Suspense, lazy } from "react";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

// Keep the detail view out of the route entry so CI stays ≤ 150 KB gzip
// (scripts/bundle-budget.mjs); Turbopack size floats a few hundred bytes.
const MeetingDetailView = lazy(() =>
  import("@uniwork/views/meetings/meeting-detail-view").then((m) => ({
    default: m.MeetingDetailView,
  })),
);

export default function MeetingDetailPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return (
    <Suspense fallback={null}>
      <MeetingDetailView
        workspaceId={workspace.id}
        meetingId={meetingId}
        onJoin={() => push(ws.room(meetingId))}
        onDeleted={() => push(ws.meetings())}
      />
    </Suspense>
  );
}
