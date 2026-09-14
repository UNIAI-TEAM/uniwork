"use client";
import { Suspense, lazy, useEffect } from "react";
import { HOME_PAGE_FLAG, usePublicConfig } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

// The home screen pulls every section; lazy keeps the route entry chunk light.
const HomeView = lazy(() =>
  import("@uniwork/views/home/home-view").then((m) => ({ default: m.HomeView })),
);

/**
 * Workspace root. With `home_page` on it is the home screen; otherwise it
 * forwards to the task list, as before. It waits for the public config so a
 * person with the flag on is never bounced to /tasks while it loads.
 */
export default function WorkspaceHome() {
  const { workspace } = useWorkspace();
  const { replace } = useNavigation();
  const config = usePublicConfig();
  const homeEnabled = config.data?.flags[HOME_PAGE_FLAG] === true;
  const settled = !config.isPending;

  useEffect(() => {
    if (settled && !homeEnabled) {
      replace(paths.workspace(workspace.organization_slug, workspace.slug).tasks());
    }
  }, [settled, homeEnabled, replace, workspace]);

  if (!homeEnabled) return null;
  return (
    <Suspense fallback={null}>
      <HomeView />
    </Suspense>
  );
}
