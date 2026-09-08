import { taskKeys } from "./keys";

export type CacheUpdatePlan = {
  type: "patch" | "invalidate";
  keys: readonly (readonly unknown[])[];
};

export type CacheUpdateEvent = {
  type: string;
  payload?: Record<string, string>;
};

/**
 * Map a Work Management realtime event to cache actions.
 *
 * Frames carry ids only, so the safe default is invalidate + refetch from the
 * API. `patch` is reserved for projections that are locally certain without
 * reading the payload body (Task 12 may use it later).
 */
export function planCacheUpdate(wsId: string, event: CacheUpdateEvent): CacheUpdatePlan {
  const payload = event.payload ?? {};
  const keys: (readonly unknown[])[] = [];
  const push = (...items: (readonly unknown[])[]) => {
    for (const k of items) keys.push(k);
  };

  switch (event.type) {
    case "task.created":
    case "task.updated":
    case "task.deleted": {
      push(taskKeys.list(wsId), taskKeys.myTasks(wsId), taskKeys.queryRoot(wsId), taskKeys.tableRoot(wsId));
      if (payload.task_id) {
        push(taskKeys.detail(payload.task_id), taskKeys.children(payload.task_id));
      }
      break;
    }
    case "task.comment_added":
    case "task.comment_updated":
    case "task.comment_deleted":
    case "task.comment_resolved":
    case "task.comment_unresolved":
    case "comment.reaction_added":
    case "comment.reaction_removed": {
      if (payload.task_id) push(taskKeys.comments(payload.task_id));
      break;
    }
    case "task.reaction_added":
    case "task.reaction_removed":
    case "task.subscribed":
    case "task.unsubscribed": {
      if (payload.task_id) {
        push(taskKeys.detail(payload.task_id), taskKeys.subscribers(payload.task_id));
      }
      break;
    }
    case "task_status.created":
    case "task_status.updated":
    case "task_status.deleted": {
      push(taskKeys.statuses(wsId));
      break;
    }
    case "task_label.created":
    case "task_label.updated":
    case "task_label.deleted": {
      push(taskKeys.labels(wsId));
      if (payload.label_id) push(taskKeys.label(wsId, payload.label_id));
      break;
    }
    case "task_property.created":
    case "task_property.updated": {
      push(taskKeys.properties(wsId));
      break;
    }
    case "task_view.created":
    case "task_view.updated":
    case "task_view.deleted": {
      push(taskKeys.views(wsId));
      if (payload.view_id) push(taskKeys.view(wsId, payload.view_id));
      break;
    }
    case "task_view_preference.updated": {
      push(taskKeys.viewPrefs(wsId, ""));
      break;
    }
    case "task_pin.created":
    case "task_pin.deleted":
    case "task_pin.reordered": {
      push(taskKeys.pins(wsId));
      break;
    }
    case "project.created":
    case "project.updated":
    case "project.deleted": {
      push(taskKeys.projects(wsId));
      if (payload.project_id) push(taskKeys.project(wsId, payload.project_id));
      break;
    }
    case "project_resource.created":
    case "project_resource.updated":
    case "project_resource.deleted": {
      if (payload.project_id) {
        push(
          taskKeys.project(wsId, payload.project_id),
          taskKeys.projectResources(wsId, payload.project_id),
        );
      } else {
        push(taskKeys.projects(wsId));
      }
      break;
    }
    default:
      break;
  }

  return { type: "invalidate", keys };
}
