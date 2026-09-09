"use client";

import { Suspense, lazy } from "react";
import { useFlag } from "@uniwork/core/feature-flags";
import { RuntimesUnavailable } from "@uniwork/views/runtimes/runtimes-unavailable";

// Flag-on body pulls the runtimes list; lazy so flag-off stays under the route budget.
const RuntimesListPage = lazy(() =>
  import("@uniwork/views/runtimes/runtimes-list-page").then((m) => ({
    default: m.RuntimesListPage,
  })),
);

export default function RuntimesPage() {
  const parity = useFlag("tasks_work_management_parity", false);

  if (!parity) {
    return <RuntimesUnavailable />;
  }

  return (
    <Suspense fallback={null}>
      <RuntimesListPage />
    </Suspense>
  );
}
