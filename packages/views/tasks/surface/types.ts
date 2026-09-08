import type { ReactNode } from "react";
import type { TaskScope } from "@uniwork/core/tasks/surface/scope";
import type { TaskViewMode } from "@uniwork/core/tasks/stores/view-store-types";
import type { TaskSurfaceController } from "./use-task-surface-controller";

export type TaskSurfaceMode = Extract<
  TaskViewMode,
  "board" | "list" | "table" | "swimlane" | "gantt"
>;

export type TaskSurfaceProps = {
  /** Explicit workspace id — UniWork pages pass this; Multica’s useWorkspaceId is not wired here. */
  workspaceId: string;
  scope: TaskScope;
  modes: TaskSurfaceMode[];
  surfaceKey: string;
  batchToolbar?: "always" | "list" | "never";
  /** Host navigation into task detail; omitted modes stay non-clickable. */
  onOpenTask?: (id: string) => void;
  renderHeader?: (ctx: { controller: TaskSurfaceController }) => ReactNode;
  renderEmpty?: () => ReactNode;
};
