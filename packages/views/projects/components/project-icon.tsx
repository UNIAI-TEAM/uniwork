import type { Project } from "@uniwork/core/types/project";
import { cn } from "@uniwork/ui/lib/utils";

export type ProjectIconSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<ProjectIconSize, string> = {
  sm: "size-3.5 text-caption leading-none",
  md: "size-4 text-body leading-none",
  lg: "size-6 text-title leading-none",
};

export function ProjectIcon({
  project,
  size = "sm",
  className,
}: {
  project?: Pick<Project, "icon"> | null;
  size?: ProjectIconSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        SIZE_CLASS[size],
        className,
      )}
    >
      {project?.icon || "📁"}
    </span>
  );
}
