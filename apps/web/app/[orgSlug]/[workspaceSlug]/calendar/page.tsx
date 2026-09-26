"use client";

import { Suspense, lazy, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  calendarPreferencesSearch,
  parseCalendarPreferences,
  type CalendarPreferences,
} from "@uniwork/core/calendar/preferences";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

const CalendarPageView = lazy(() =>
  import("@uniwork/views/calendar/calendar-page").then((m) => ({
    default: m.CalendarPageView,
  })),
);

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageContent />
    </Suspense>
  );
}

function CalendarPageContent() {
  const { workspace } = useWorkspace();
  const { push, replace } = useNavigation();
  const searchParams = useSearchParams();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const preferences = parseCalendarPreferences(searchParams);
  const handlePreferencesChange = useCallback(
    (next: CalendarPreferences) => {
      const query = calendarPreferencesSearch(searchParams.toString(), next);
      replace(query ? `${ws.calendar()}?${query}` : ws.calendar());
    },
    [replace, searchParams, ws],
  );

  return (
    <CalendarPageView
      workspaceId={workspace.id}
      initialPreferences={preferences}
      onPreferencesChange={handlePreferencesChange}
      onOpenTask={(id) => push(ws.task(id))}
      onOpenMeeting={(id) => push(ws.meeting(id))}
      onJoinMeeting={(id) => push(ws.room(id))}
    />
  );
}
