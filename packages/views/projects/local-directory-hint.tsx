"use client";

/**
 * Activity-section banner for a project's local_directory resource.
 *
 * On a desktop host this would explain how an agent uses a registered local
 * path when the daemon matches. Web has no daemon (`tasks.local_workdir` is
 * unavailable), so the disabled path returns null — same geometric slot for
 * Task 7+ when the capability ships, without importing daemon APIs.
 */
export function LocalDirectoryHint(_props: {
  workspaceId: string;
  projectId: string | null | undefined;
}) {
  return null;
}
