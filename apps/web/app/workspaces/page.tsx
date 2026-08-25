"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { WorkspacePickerView } from "@uniwork/views/workspace/workspace-picker-view";

export default function WorkspacesPage() {
  const router = useRouter();
  const { status } = useSession();
  useEffect(() => {
    if (status === "anon") router.replace(paths.login());
  }, [status, router]);
  if (status !== "authed") return null;
  return (
    <WorkspacePickerView
      onPick={(w) => router.push(paths.workspace(w.organization_slug, w.slug).tasks())}
      onCreate={() => router.replace(paths.newWorkspace())}
    />
  );
}
