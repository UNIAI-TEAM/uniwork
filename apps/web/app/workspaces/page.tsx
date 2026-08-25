"use client";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { WorkspacePickerView } from "@uniwork/views/workspace/workspace-picker-view";

export default function WorkspacesPage() {
  const { push, replace } = useNavigation();
  const { status } = useSession();
  useEffect(() => {
    if (status === "anon") replace(paths.login());
  }, [status, replace]);
  if (status !== "authed") return null;
  return (
    <WorkspacePickerView
      onPick={(w) => push(paths.workspace(w.organization_slug, w.slug).tasks())}
      onCreate={() => replace(paths.newWorkspace())}
    />
  );
}
