/**
 * The empty state of a companion section: one line, no icon and no button,
 * because the section header already links to the full list. A big empty
 * state here would outweigh the work actually on the page.
 */
export function HomeQuietNote({ children }: { children: string }) {
  return <p className="px-4 py-4 text-body text-pretty text-muted-foreground">{children}</p>;
}
