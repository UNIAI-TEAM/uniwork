"use client";
import { useEffect } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

export default function WorkspaceHome() {
  const { workspace } = useWorkspace();
  const { replace } = useNavigation();
  useEffect(() => {
    replace(paths.workspace(workspace.organization_slug, workspace.slug).tasks());
  }, [replace, workspace]);
  return null;
}
