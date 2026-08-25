"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function WorkspaceHome() {
  const router = useRouter();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  useEffect(() => router.replace(`/${workspaceSlug}/tasks`), [router, workspaceSlug]);
  return null;
}
