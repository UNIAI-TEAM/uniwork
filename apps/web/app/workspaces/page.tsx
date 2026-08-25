"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { WorkspacePickerView } from "@uniwork/views/workspace/workspace-picker-view";

export default function WorkspacesPage() {
  const router = useRouter();
  const { status } = useSession();
  useEffect(() => {
    if (status === "anon") router.replace("/login");
  }, [status, router]);
  if (status !== "authed") return null;
  return <WorkspacePickerView onPick={(w) => router.push(`/${w.slug}/tasks`)} />;
}
