// The workspace picker's list (app/(app)/select-workspace.tsx): the rows, what the screen shows without them
// (lib/list-view.ts: "empty" only once the server answered with none), and a Retry that asks now.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Workspace } from "@uniwork/core/types/workspace";
import { useCallback } from "react";
import { workspaceKeys, workspaceListOptions } from "@/data/queries/workspaces";
import { listView, type ListView } from "@/lib/list-view";

interface WorkspaceList {
  data: Workspace[] | undefined;
  view: ListView;
  retry: () => Promise<void>;
}

export function useWorkspaceList(): WorkspaceList {
  const queryClient = useQueryClient();
  const query = useQuery(workspaceListOptions());
  const { refetch } = query;
  const retry = useCallback(async () => {
    // A retry paused offline only continues once onlineManager says online, and refetch() joins it rather than
    // starting over; a person's Retry drops it and asks now (the list's first attempt runs offline too).
    await queryClient.cancelQueries({ queryKey: workspaceKeys.list() });
    await refetch();
  }, [queryClient, refetch]);
  return { data: query.data, view: listView(query), retry };
}
