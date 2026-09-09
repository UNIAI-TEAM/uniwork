export function ProjectIcon({ icon }: { icon?: string | null; status?: string }) {
  return <span aria-hidden>{icon || "📁"}</span>;
}
