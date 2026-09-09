"use client";

import { Suspense, lazy } from "react";
import { useFlag } from "@uniwork/core/feature-flags";
import { SquadsUnavailable } from "@uniwork/views/squads/squads-unavailable";

// Flag-on body pulls the squads list; lazy so flag-off stays under the route budget.
const SquadsListPage = lazy(() =>
  import("@uniwork/views/squads/squads-list-page").then((m) => ({
    default: m.SquadsListPage,
  })),
);

export default function SquadsPage() {
  const parity = useFlag("tasks_work_management_parity", false);

  if (!parity) {
    return <SquadsUnavailable />;
  }

  return (
    <Suspense fallback={null}>
      <SquadsListPage />
    </Suspense>
  );
}
