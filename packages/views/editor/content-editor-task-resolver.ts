import type { QueryClient } from "@tanstack/react-query";
import { isTaskIdentifier } from "@uniwork/ui/markdown";
import type { TaskIdentifierResolver } from "./extensions/task-identifier-autolink";
import { taskIdentifierOptions, workspaceListOptions } from "./task-identifier-queries";

/** Linear-style bare identifier autolink resolver for the content editor. */
export function createTaskIdentifierResolver(
  queryClient: QueryClient,
  getWorkspaceSlug: () => string | null,
): TaskIdentifierResolver {
  return async (identifier) => {
    if (!isTaskIdentifier(identifier)) return null;
    const slug = getWorkspaceSlug();
    if (!slug) return null;
    const workspaces = await queryClient.fetchQuery(workspaceListOptions(""));
    const ws = workspaces.find(
      (w) => w.slug === slug || slug.endsWith(`/${w.slug}`) || slug === w.slug,
    );
    if (!ws) return null;
    const prefix = ws.issue_prefix;
    if (prefix && !identifier.toUpperCase().startsWith(`${prefix.toUpperCase()}-`)) {
      return null;
    }
    const task = await queryClient.fetchQuery(taskIdentifierOptions(ws.id, identifier));
    return task ? { id: task.id, identifier: task.identifier } : null;
  };
}
