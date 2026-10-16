import type { Task } from "@uniwork/core/types";
import type { CardProperties } from "@uniwork/core/tasks/stores/view-store";

export const DEMO_TASK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "blocked"] as const;
export type DemoTaskStatus = typeof DEMO_TASK_STATUSES[number];
export type DemoTask = { key: string; title?: string; identifier?: string; state: DemoTaskStatus; person: string; category?: string };

export const DEMO_TASKS: DemoTask[] = [
  { key: "brief", identifier: "UNI-21", state: "todo", person: "TN" },
  { key: "uranus", identifier: "UNI-16", state: "todo", person: "" },
  { key: "mytel", identifier: "UNI-15", state: "todo", person: "" },
  { key: "viconnect", identifier: "UNI-14", state: "todo", person: "" },
  { key: "simulation", identifier: "UNI-13", state: "todo", person: "TN" },
  { key: "design", identifier: "UNI-18", state: "in_progress", person: "TN" },
  { key: "review", identifier: "UNI-17", state: "in_progress", person: "TN" },
  { key: "launch", identifier: "UNI-20", state: "in_progress", person: "TN" },
];
export const DEMO_CARD_PROPERTIES: CardProperties = { priority: true, description: false, assignee: true, startDate: false, dueDate: false, project: true, childProgress: false, labels: false };
export const DEMO_PEOPLE: Record<string, string> = { TN: "Tuan Nguyen", HA: "Hoàng Anh", ML: "Minh Linh", "Đ": "Đạt Đặng" };

/** Sample records use the production card contract, so the demo cannot drift into a second card design. */
export function demoTaskRecord(task: DemoTask, title: string): Task {
  return {
    id: task.key, organization_id: "sample", workspace_id: "sample", number: 0, identifier: task.identifier ?? "UNI-22", revision: 1,
    title, description: "", status: task.state, priority: "none", assignee_kind: "human",
    ...(task.person ? { assignee_id: task.person, assignee: { id: task.person, kind: "human" as const, display_name: DEMO_PEOPLE[task.person] ?? task.person } } : {}),
    project_id: "uniwork", position: 1, kind: "normal", created_by: "sample", created_by_kind: "human",
    created_at: "2026-10-14T08:00:00Z", updated_at: "2026-10-15T08:00:00Z",
  };
}
