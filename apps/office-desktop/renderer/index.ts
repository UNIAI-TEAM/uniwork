import { renderDesktopShell } from "./shell";

export function mountDesktopRenderer(documentLike: { getElementById(id: string): { textContent: string | null; setAttribute(name: string, value: string): void } | null }): void {
  const root = documentLike.getElementById("root");
  if (root) renderDesktopShell(root);
}

if (typeof document !== "undefined") mountDesktopRenderer(document);
