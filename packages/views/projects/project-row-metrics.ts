import type { Project } from "@uniwork/core/types/project";

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

export function leadFilterValue(
  project: Pick<Project, "lead_type" | "lead_id">,
): string | null {
  return project.lead_type && project.lead_id
    ? `${project.lead_type}:${project.lead_id}`
    : null;
}

/** Human/member leads resolve via workspace members; agents and missing ids stay null. */
export function resolveProjectLeadName(
  project: Pick<Project, "lead_type" | "lead_id">,
  memberNamesByUserId: ReadonlyMap<string, string>,
): string | null {
  if (!project.lead_id) return null;
  if (project.lead_type !== "member" && project.lead_type !== "human") {
    return null;
  }
  return memberNamesByUserId.get(project.lead_id) ?? null;
}
