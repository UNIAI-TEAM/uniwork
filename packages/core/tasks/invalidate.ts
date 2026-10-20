import type { QueryClient } from "@tanstack/react-query";
import { calendarKeys } from "../calendar/keys";
import { taskKeys } from "./keys";

/**
 * Every workspace collection a newly created task can appear in: the flat
 * list, the paged query and my-tasks roots (list, My Tasks, Gantt, swimlane),
 * the table views and the calendar. Each mutation that creates tasks calls
 * this rather than naming its own subset, so a missed realtime frame (socket
 * down) never leaves one surface stale while another shows the new task. The
 * returned promise settles once the flat list has refetched.
 */
export function invalidateTaskCollections(qc: QueryClient, workspaceId: string): Promise<void> {
  void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
  void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
  void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
  void qc.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
  return qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
}
