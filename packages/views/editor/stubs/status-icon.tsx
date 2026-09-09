import type { SVGProps } from "react";

/** Placeholder status glyph until task-detail suite ports UniWork StatusIcon. */
export function StatusIcon(_props: SVGProps<SVGSVGElement> & { category?: string }) {
  return <span aria-hidden className="inline-block size-3 rounded-full bg-muted-foreground/40" />;
}
