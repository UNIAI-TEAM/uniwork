export function TaskMentionCard({
  label,
  id,
  issueId,
  fallbackLabel,
}: {
  label?: string;
  id?: string;
  issueId?: string;
  fallbackLabel?: string;
}) {
  return (
    <span className="rounded bg-muted px-1 text-caption">
      {label ?? fallbackLabel ?? id ?? issueId ?? "task"}
    </span>
  );
}
