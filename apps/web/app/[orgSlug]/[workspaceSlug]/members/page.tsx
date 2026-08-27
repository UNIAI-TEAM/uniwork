"use client";

import { useEffect } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

/** Legacy route — members live under Settings now. */
export default function MembersRedirectPage() {
  const { workspace } = useWorkspace();
  const { replace } = useNavigation();
  useEffect(() => {
    replace(
      `${paths.workspace(workspace.organization_slug, workspace.slug).settings()}?tab=members`,
    );
  }, [replace, workspace.organization_slug, workspace.slug]);

  return null;
}
