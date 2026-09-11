"use client";

import type { Project } from "@uniwork/core/types/project";
import { getProjectTaskMetrics } from "../project-row-metrics";

export function ProjectProgressRing({ project }: { project: Project }) {
  const { totalCount, completedCount } = getProjectTaskMetrics(project);
  if (totalCount === 0) {
    return <span className="text-caption text-muted-foreground">—</span>;
  }
  const pct = Math.round((completedCount / totalCount) * 100);
  return (
    <span className="flex items-center gap-1.5">
      <span className="relative h-3.5 w-3.5">
        <svg className="h-3.5 w-3.5 -rotate-90" viewBox="0 0 16 16" aria-hidden>
          <circle
            className="text-muted"
            strokeWidth="2"
            stroke="currentColor"
            fill="none"
            r="6"
            cx="8"
            cy="8"
          />
          <circle
            className="text-success"
            strokeWidth="2"
            stroke="currentColor"
            fill="none"
            r="6"
            cx="8"
            cy="8"
            strokeDasharray={`${pct * 0.377} 37.7`}
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="text-caption tabular-nums text-muted-foreground">
        {completedCount}/{totalCount}
      </span>
    </span>
  );
}
