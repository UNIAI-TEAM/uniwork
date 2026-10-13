"use client";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { useOrganizations } from "@uniwork/core/organizations";
import { paths, usePendingAuthStep } from "@uniwork/core/paths";
import { holdsOrganization } from "@uniwork/core/types";
import { useNavigation } from "@uniwork/views/navigation";
import { WorkspacePickerView } from "@uniwork/views/workspace/workspace-picker-view";

export default function WorkspacesPage() {
  const { push, replace } = useNavigation();
  const { status } = useSession();
  const step = usePendingAuthStep();
  // No workspace and no organization left (left or closed it, or the
  // membership was switched off — ADR 0032 D1, D12): the way on is
  // /get-started, not a workspace in an organization they lack.
  const { data: organizations, isFetched: orgsFetched } = useOrganizations(status === "authed");
  useEffect(() => {
    if (status === "anon") replace(paths.login());
    if (status === "authed" && step === "verify") replace(paths.verify());
  }, [status, step, replace]);
  if (status !== "authed" || step === "verify" || !orgsFetched) return null;
  return (
    <WorkspacePickerView
      onPick={(w) => push(paths.workspace(w.organization_slug, w.slug).tasks())}
      onCreate={() =>
        replace(organizations && !organizations.some(holdsOrganization) ? paths.getStarted() : paths.newWorkspace())
      }
    />
  );
}
