import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import type { NotificationKind } from "@uniwork/core/types";
import { moduleTone } from "../layout/module-tones";

/**
 * The tint of a notification's mark follows the module the event came from,
 * read from the same table the sidebar uses — so a task notification carries
 * the tasks green the person already knows from the nav, a meeting one the
 * meetings violet. A kind from a newer server, or one with no module, takes
 * the neutral grey.
 */
const KIND_TONES: Record<NotificationKind, Tint> = {
  task_assigned: moduleTone("tasks"),
  task_status_changed: moduleTone("tasks"),
  task_commented: moduleTone("tasks"),
  mentioned: moduleTone("chat"),
  chat_follow_up: moduleTone("chat"),
  meeting_invited: moduleTone("meetings"),
  meeting_starting: moduleTone("meetings"),
  member_added: moduleTone("people"),
  role_changed: moduleTone("people"),
  audit_export_ready: "gray",
  email_hub_new_mail: moduleTone("email"),
};

export function kindTone(kind: string): Tint {
  return (KIND_TONES as Record<string, Tint>)[kind] ?? "gray";
}
