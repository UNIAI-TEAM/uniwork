import { taskKeys } from "./keys";
import { parseTaskPatchFrame, type TaskPatchFrame } from "./realtime-task-patch";

export type CacheUpdatePlan = {
  type: "invalidate";
  keys: readonly (readonly unknown[])[];
  /**
   * Set only for a `task.updated` frame that carries Patch fields beside a
   * valid revision pair (ADR 0015). The caller applies it with
   * `applyTaskPatchFrame` before invalidating, and drops `taskKeys.detail`
   * from `keys` only when that call patched the detail entry; list roots stay.
   */
  patch?: TaskPatchFrame;
};

export type CacheUpdateEvent = {
  type: string;
  payload?: Record<string, string>;
};

/**
 * Map a Work Management realtime event to cache actions.
 *
 * `keys` is always the full invalidation set, so a frame the client cannot
 * patch refetches exactly as before ADR 0015. The only payload fields read are
 * ids, plus the Patch fields and revisions of `task.updated` (`patch`). `type`
 * stays `invalidate`: `patch` is applied beside the keys, never instead of them.
 */
export function planCacheUpdate(wsId: string, event: CacheUpdateEvent): CacheUpdatePlan {
  const payload = event.payload ?? {};
  const keys: (readonly unknown[])[] = [];
  const push = (...items: (readonly unknown[])[]) => {
    for (const k of items) keys.push(k);
  };
  let patch: TaskPatchFrame | null = null;

  switch (event.type) {
    case "task.created":
    case "task.updated":
    case "task.deleted": {
      push(taskKeys.list(wsId), taskKeys.myTasks(wsId), taskKeys.queryRoot(wsId), taskKeys.tableRoot(wsId));
      if (payload.task_id) {
        push(taskKeys.detail(payload.task_id), taskKeys.children(payload.task_id));
        if (event.type === "task.updated") push(taskKeys.subscribers(payload.task_id));
      }
      // Only task.updated declares Patch in the catalogue.
      if (event.type === "task.updated") patch = parseTaskPatchFrame(payload);
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
    case "attachment.uploaded":
    case "attachment.deleted": {
      if (payload.task_id) {
        push(taskKeys.attachments(wsId, payload.task_id));
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
      push(taskKeys.viewPrefs(wsId));
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

  return patch ? { type: "invalidate", keys, patch } : { type: "invalidate", keys };
}
