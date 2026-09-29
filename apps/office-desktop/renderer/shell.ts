export const DESKTOP_SHELL_PLACEHOLDER = "UniWork Office desktop shell (development host)";

/** Shared views/core receive runtime, navigation and transport through this
 * adapter. This placeholder is deliberately not an editor or login claim. */
export function renderDesktopShell(root: { textContent: string | null; setAttribute(name: string, value: string): void }): void {
  root.textContent = DESKTOP_SHELL_PLACEHOLDER;
  root.setAttribute("data-host", "office-desktop");
  root.setAttribute("data-build", "unsigned-dev");
}
