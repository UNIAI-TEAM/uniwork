import { paths } from "@uniwork/core/paths";
import type { Notification, Workspace } from "@uniwork/core/types";

/** Where a click goes, mirroring notification.ResourceURL on the server. */
export function resourceHref(n: Notification, workspace: Workspace): string {
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  switch (n.resource_type) {
    case "task":
      return ws.task(n.resource_id);
    case "meeting":
      return ws.meeting(n.resource_id);
    case "audit_export":
      return `${ws.settings()}?tab=audit`;
    case "chat_message":
      return ws.chat();
    default:
      return ws.inbox();
  }
}
