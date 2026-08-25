"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { paths } from "@uniwork/core/paths";

export default function WorkspaceHome() {
  const router = useRouter();
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  useEffect(() => router.replace(paths.workspace(orgSlug, workspaceSlug).tasks()), [router, orgSlug, workspaceSlug]);
  return null;
}
