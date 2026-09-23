"use client";

import { Suspense, lazy } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

const CalendarPageView = lazy(() =>
  import("@uniwork/views/calendar/calendar-page").then((m) => ({
    default: m.CalendarPageView,
  })),
);

export default function CalendarPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  return (
    <Suspense fallback={null}>
      <CalendarPageView
        workspaceId={workspace.id}
        onOpenTask={(id) => push(ws.task(id))}
        onOpenMeeting={(id) => push(ws.meeting(id))}
      />
    </Suspense>
  );
}
