import type { ProjectResource } from "@uniwork/core/types/project";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function githubShortLabel(url: string): string {
  const trimmed = url.trim();
  try {
    const path = new URL(trimmed).pathname.replace(/^\//, "").replace(/\.git$/, "");
    return path || trimmed;
  } catch {
    return trimmed.replace(/\.git$/, "").split("/").filter(Boolean).slice(-2).join("/") || trimmed;
  }
}

/** Display label for a project resource row (label column, then ref fields). */
export function resourceDisplayLabel(resource: ProjectResource): string {
  const label = (resource.label ?? "").trim();
  if (label) return label;

  const ref = asRecord(resource.resource_ref);
  if (!ref) return resource.resource_type;

  if (resource.resource_type === "github_repo") {
    const url = typeof ref.url === "string" ? ref.url : "";
    const gitRef = typeof ref.ref === "string" ? ref.ref : "";
    if (!url) return resource.resource_type;
    const short = githubShortLabel(url);
    return gitRef ? `${short} @ ${gitRef}` : short;
  }

  if (resource.resource_type === "local_directory") {
    const refLabel = typeof ref.label === "string" ? ref.label.trim() : "";
    const path = typeof ref.local_path === "string" ? ref.local_path.trim() : "";
    return refLabel || path || resource.resource_type;
  }

  return resource.resource_type;
}
