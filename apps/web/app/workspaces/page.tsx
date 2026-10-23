"use client";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { useOrganizations } from "@uniwork/core/organizations";
import { paths, usePendingAuthStep, workspacelessDestination } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";
import { WorkspacePickerView } from "@uniwork/views/workspace/workspace-picker-view";

export default function WorkspacesPage() {
  const { push, replace } = useNavigation();
  const { status } = useSession();
  const step = usePendingAuthStep();
  // No workspace to pick: /get-started without an organization (ADR 0032
  // D1, D12), /no-workspace for a member nobody has given a workspace yet
  // (UNI-1472), and creating one only for the owner or an admin.
  const { data: organizations, isFetched: orgsFetched } = useOrganizations(status === "authed");
  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (status === "authed" && step === "verify") replace(paths.verify());
  }, [status, step, replace]);
  if (status !== "authed" || step === "verify" || !orgsFetched) return null;
  return (
    <WorkspacePickerView
      onPick={(w) => push(paths.workspace(w.organization_slug, w.slug).tasks())}
      onEmpty={() => replace(workspacelessDestination(organizations))}
      onCreate={() => push(paths.newWorkspace())}
    />
  );
}
