export const DESKTOP_SHELL_PLACEHOLDER = "UniWork Office desktop shell (development host)";

type ShellRoot = { textContent: string | null; setAttribute(name: string, value: string): void };
type ShellRenderAdapter = Readonly<{
  t?: (key: "shell.signOut") => string;
  registry?: { button?: (props: Readonly<{ label: string; action: "logout"; onClick?: () => void }>) => unknown };
  session?: { accountId: string; deploymentId: string };
}>;

/** Shared views/core receive runtime, navigation and transport through this
 * adapter. This placeholder is deliberately not an editor or login claim. */
export function renderDesktopShell(root: ShellRoot, adapter: ShellRenderAdapter = {}): void {
  root.textContent = DESKTOP_SHELL_PLACEHOLDER;
  root.setAttribute("data-host", "office-desktop");
  root.setAttribute("data-build", "unsigned-dev");
  root.setAttribute("data-session-status", "signed-in");
  if (adapter.session) {
    root.setAttribute("data-account-id", adapter.session.accountId);
    root.setAttribute("data-deployment-id", adapter.session.deploymentId);
  }
  adapter.registry?.button?.({ label: adapter.t?.("shell.signOut") ?? "Sign out", action: "logout" });
}
