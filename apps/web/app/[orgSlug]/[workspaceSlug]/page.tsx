"use client";
import { Suspense, lazy } from "react";

// The home screen pulls every section; lazy keeps the route entry chunk light.
const HomeView = lazy(() =>
  import("@uniwork/views/home/home-view").then((m) => ({ default: m.HomeView })),
);

/** Workspace root: the home screen. */
export default function WorkspaceHome() {
  return (
    <Suspense fallback={null}>
      <HomeView />
    </Suspense>
  );
}
