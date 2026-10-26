"use client";

import { Suspense, lazy } from "react";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";

const TasksTrashPage = lazy(() =>
  import("@uniwork/views/tasks/trash/tasks-trash-page").then((m) => ({
    default: m.TasksTrashPage,
  })),
);

export default function TasksTrashRoute() {
  const { workspace } = useWorkspace();

  return (
    <Suspense fallback={null}>
      <TasksTrashPage workspaceId={workspace.id} />
    </Suspense>
  );
}
