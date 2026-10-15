import { calendarKeys } from "../calendar/keys";
import { chatKeys } from "../chat/hooks";
import { documentKeys } from "../documents/keys";
import { graphKeys } from "../graph/keys";
import { meetingKeys } from "../meetings/hooks";
import { notificationKeys } from "../notifications/hooks";
import { taskKeys } from "../tasks/hooks";

/** Keys that could have gone stale while the socket was down. */
export function allWorkspaceKeys(wsId: string) {
  return [
    taskKeys.list(wsId),
    taskKeys.myTasks(wsId),
    taskKeys.queryRoot(wsId),
    taskKeys.tableRoot(wsId),
    taskKeys.statuses(wsId),
    taskKeys.labels(wsId),
    taskKeys.properties(wsId),
    taskKeys.views(wsId),
    taskKeys.viewPrefs(wsId),
    taskKeys.pins(wsId),
    taskKeys.projects(wsId),
    chatKeys.rooms(wsId),
    chatKeys.room(wsId),
    // Open room timelines refresh their newest page and room task links are
    // emptied instead (refreshLoadedRoomTimelines).
    // Roots, not the builders: those append filters and would miss variants.
    ["chat", "room-members", wsId],
    chatKeys.followUps(wsId),
    ["chat", "followed-threads", wsId],
    ["chat", "channels", wsId],
    ["chat", "project-channels", wsId],
    chatKeys.messages(wsId),
    chatKeys.threadMessagesRoot(wsId),
    meetingKeys.list(wsId),
    meetingKeys.stats(wsId),
    calendarKeys.all(wsId),
    meetingKeys.joinRequestsRoot,
    notificationKeys.lists(),
    notificationKeys.unreadCount(),
    // Documents go stale while the socket is down; workspace root is the
    // prefix of every document key, and the org-scoped favorites list is a
    // different branch of the same feature.
    documentKeys.workspace(wsId),
    documentKeys.favoritesRoot,
    graphKeys.workspace(wsId),
  ];
}
