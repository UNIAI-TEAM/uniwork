export function ProjectMentionCard({
  label,
  id,
  projectId,
  fallbackLabel,
}: {
  label?: string;
  id?: string;
  projectId?: string;
  fallbackLabel?: string;
}) {
  return (
    <span className="rounded bg-muted px-1 text-caption">
      {label ?? fallbackLabel ?? id ?? projectId ?? "project"}
    </span>
  );
}
