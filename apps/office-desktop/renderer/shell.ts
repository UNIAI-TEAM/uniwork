export const DESKTOP_SHELL_PLACEHOLDER = "UniWork Office desktop shell (development host)";

type ShellRoot = { textContent: string | null; setAttribute(name: string, value: string): void };
export type DesktopRecoveryState = "none" | "available" | "conflict" | "blocked" | "locked" | "unavailable";
const DEFAULT_COPY: Readonly<Record<string, string>> = Object.freeze({
  "shell.signOut": "Sign out",
  "office.recovery.available": "Draft ready to recover",
  "office.recovery.conflict": "Draft belongs to another document version",
  "office.recovery.blocked": "Draft recovery is blocked",
  "office.recovery.locked": "Draft recovery is locked",
  "office.recovery.unavailable": "Draft recovery is temporarily unavailable",
});
type ShellRenderAdapter = Readonly<{
  t?: (key: string) => string;
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
  adapter.registry?.button?.({ label: adapter.t?.("shell.signOut") ?? DEFAULT_COPY["shell.signOut"] ?? "Sign out", action: "logout" });
}

/** Render the recovery affordance without giving a blocked draft an export,
 * copy or clipboard path. Bytes remain behind the main-process typed bridge. */
export function renderDesktopRecoveryState(root: ShellRoot, state: DesktopRecoveryState, t: (key: string) => string = (key) => DEFAULT_COPY[key] ?? key): void {
  root.setAttribute("data-recovery-state", state);
  const labels: Record<DesktopRecoveryState, string> = {
    none: "",
    available: t("office.recovery.available"),
    conflict: t("office.recovery.conflict"),
    blocked: t("office.recovery.blocked"),
    locked: t("office.recovery.locked"),
    unavailable: t("office.recovery.unavailable"),
  };
  if (state !== "none") root.textContent = labels[state];
}

/** Keep the response-to-view mapping in one main/renderer-neutral table. The
 * renderer never receives ciphertext; it only receives a typed status. */
export function desktopRecoveryStateFromStatus(status: "recovered" | "missing" | "ambiguous" | "conflict" | "blocked" | "locked"): DesktopRecoveryState {
  if (status === "recovered") return "available";
  if (status === "conflict") return "conflict";
  if (status === "blocked") return "blocked";
  if (status === "locked") return "locked";
  return "none";
}

export function desktopRecoveryStateFromError(code: "token_expired" | "storage_unavailable" | "draft_recovery_locked"): DesktopRecoveryState {
  return code === "storage_unavailable" ? "unavailable" : "locked";
}
