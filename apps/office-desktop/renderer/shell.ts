export const DESKTOP_SHELL_PLACEHOLDER = "UniWork Office desktop shell (development host)";

type ShellRoot = { textContent: string | null; setAttribute(name: string, value: string): void };
export type DesktopRecoveryState = "none" | "available" | "conflict" | "blocked" | "locked";
type ShellRenderAdapter = Readonly<{
  t?: (key: "shell.signOut") => string;
  registry?: { button?: (props: Readonly<{ label: string; action: "logout"; onClick?: () => void }>) => unknown };
  session?: { accountId: string; deploymentId: string };
  recovery?: DesktopRecoveryState;
}>;

/** Shared views/core receive runtime, navigation and transport through this
 * adapter. This placeholder is deliberately not an editor or login claim. */
export function renderDesktopShell(root: ShellRoot, adapter: ShellRenderAdapter = {}): void {
  root.textContent = DESKTOP_SHELL_PLACEHOLDER;
  root.setAttribute("data-host", "office-desktop");
  root.setAttribute("data-build", "unsigned-dev");
  root.setAttribute("data-session-status", "signed-in");
  if (adapter.recovery && adapter.recovery !== "none") root.setAttribute("data-recovery-state", adapter.recovery);
  if (adapter.session) {
    root.setAttribute("data-account-id", adapter.session.accountId);
    root.setAttribute("data-deployment-id", adapter.session.deploymentId);
  }
  adapter.registry?.button?.({ label: adapter.t?.("shell.signOut") ?? "Sign out", action: "logout" });
}

/** Render the recovery affordance without giving a blocked draft an export,
 * copy or clipboard path. Bytes remain behind the main-process typed bridge. */
export function renderDesktopRecoveryState(root: ShellRoot, state: DesktopRecoveryState, t: (key: string) => string = (key) => key): void {
  root.setAttribute("data-recovery-state", state);
  const labels: Record<DesktopRecoveryState, string> = {
    none: "",
    available: t("office.recovery.available"),
    conflict: t("office.recovery.conflict"),
    blocked: t("office.recovery.blocked"),
    locked: t("office.recovery.locked"),
  };
  if (state !== "none") root.textContent = labels[state];
}
