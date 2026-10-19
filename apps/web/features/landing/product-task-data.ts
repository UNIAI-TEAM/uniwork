import type { Task } from "@uniwork/core/types";
import type { CardProperties } from "@uniwork/core/tasks/stores/view-store";
import { DEMO_MEMBERS, DEMO_PROFILE } from "./product-demo-data";

export const DEMO_TASK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "blocked"] as const;
export type DemoTaskStatus = typeof DEMO_TASK_STATUSES[number];
export type DemoTask = { key: string; title?: string; identifier?: string; state: DemoTaskStatus; person: string; category?: string };

export const DEMO_TASKS: DemoTask[] = [
  { key: "brief", identifier: "DEMO-101", state: "todo", person: "Đ" },
  { key: "research", identifier: "DEMO-102", state: "backlog", person: "ML" },
  { key: "wireframes", identifier: "DEMO-103", state: "todo", person: "HA" },
  { key: "prototype", identifier: "DEMO-104", state: "todo", person: "" },
  { key: "simulation", identifier: "DEMO-105", state: "in_review", person: "TN" },
  { key: "design", identifier: "DEMO-106", state: "in_progress", person: "TN" },
  { key: "review", identifier: "DEMO-107", state: "in_progress", person: "ML" },
  { key: "launch", identifier: "DEMO-108", state: "done", person: "HA" },
  { key: "handoff", identifier: "DEMO-109", state: "in_review", person: "Đ" },
  { key: "integration", identifier: "DEMO-110", state: "blocked", person: "TN" },
];
export const DEMO_CARD_PROPERTIES: CardProperties = { priority: true, description: false, assignee: true, startDate: false, dueDate: false, project: true, childProgress: false, labels: false };
export const DEMO_PEOPLE: Record<string, string> = { TN: DEMO_MEMBERS[3]!.name, HA: DEMO_MEMBERS[2]!.name, ML: DEMO_MEMBERS[1]!.name, "Đ": DEMO_PROFILE.name };

/** Sample records use the production card contract, so the demo cannot drift into a second card design. */
export function demoTaskRecord(task: DemoTask, title: string): Task {
  return {
    id: task.key, organization_id: "sample", workspace_id: "sample", number: 0, identifier: task.identifier ?? "DEMO-111", revision: 1,
    title, description: "", status: task.state, priority: "none", assignee_kind: "human",
    ...(task.person ? { assignee_id: task.person, assignee: { id: task.person, kind: "human" as const, display_name: DEMO_PEOPLE[task.person] ?? task.person } } : {}),
    project_id: "demo-project-0", position: 1, kind: "normal", created_by: DEMO_PROFILE.id, created_by_kind: "human",
    created_at: "2026-10-14T08:00:00Z", updated_at: "2026-10-15T08:00:00Z",
  };
}
