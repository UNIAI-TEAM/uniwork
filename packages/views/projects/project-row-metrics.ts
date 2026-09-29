import type { Project } from "@uniwork/core/types/project";
import type { LinkClickIntent } from "../navigation";
import type { AssigneeOption, AssigneeRef } from "../tasks/pickers/assignee-picker";

export type OpenProject = (projectId: string, intent?: LinkClickIntent) => void;

/** Fields a list row or card edits in place. */
export type ProjectRowPatch = {
  status?: string;
  priority?: string;
  lead_type?: string | null;
  lead_id?: string | null;
};

export function getProjectTaskMetrics(
  project: Pick<Project, "task_count" | "done_count">,
) {
  return {
    totalCount: project.task_count,
    completedCount: project.done_count,
  };
}

export function projectProgressRatio(
  project: Pick<Project, "task_count" | "done_count">,
): number {
  return project.task_count > 0 ? project.done_count / project.task_count : -1;
}

export function formatRelativeDate(iso: string, locale: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const dayMs = 86_400_000;
  const days = Math.floor(diffMs / dayMs);
  if (days <= 0) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "day");
  }
  if (days < 30) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
  }
  const months = Math.floor(days / 30);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-months, "month");
}

/** Keyed like the shared actor filter (`member:<id>` | `agent:<id>`). */
export function leadFilterValue(
  project: Pick<Project, "lead_type" | "lead_id">,
): string | null {
  const ref = projectLeadRef(project);
  if (!ref) return null;
  return `${ref.kind === "agent" ? "agent" : "member"}:${ref.id}`;
}

type ProjectLead = Pick<Project, "lead_type" | "lead_id">;

/** Projects store `member` | `agent`; the shared actor pickers speak `human` | `agent`. */
export function projectLeadRef(project: ProjectLead): AssigneeRef | null {
  if (!project.lead_id) return null;
  if (project.lead_type === "agent") return { id: project.lead_id, kind: "agent" };
  if (project.lead_type === "member" || project.lead_type === "human") {
    return { id: project.lead_id, kind: "human" };
  }
  return null;
}

export function leadRefToProjectBody(ref: AssigneeRef | null): {
  lead_type: string | null;
  lead_id: string | null;
} {
  if (!ref) return { lead_type: null, lead_id: null };
  return { lead_type: ref.kind === "agent" ? "agent" : "member", lead_id: ref.id };
}

export function findProjectLeadOption(
  project: ProjectLead,
  options: readonly AssigneeOption[],
): AssigneeOption | null {
  const ref = projectLeadRef(project);
  if (!ref) return null;
  return options.find((o) => o.id === ref.id && o.kind === ref.kind) ?? null;
}

/** Member or agent lead name; an id nobody in the workspace owns stays null. */
export function resolveProjectLeadName(
  project: ProjectLead,
  options: readonly AssigneeOption[],
): string | null {
  return findProjectLeadOption(project, options)?.name ?? null;
}
