import { expect, it } from "vitest";
import { DESKTOP_SHELL_PLACEHOLDER, desktopRecoveryStateFromError, desktopRecoveryStateFromStatus, renderDesktopRecoveryState, renderDesktopShell } from "./shell";

it("renders the shared shell placeholder without privileged APIs", () => {
  const root = { textContent: "", setAttribute: (name: string, value: string) => { root.attrs[name] = value; }, attrs: {} as Record<string, string> };
  renderDesktopShell(root);
  expect(root.textContent).toBe(DESKTOP_SHELL_PLACEHOLDER);
  expect(root.attrs).toEqual({ "data-host": "office-desktop", "data-build": "unsigned-dev", "data-session-status": "signed-in" });
});

it.each([
  ["available", "Draft ready to recover"],
  ["conflict", "Draft belongs to another document version"],
  ["blocked", "Draft recovery is blocked"],
  ["locked", "Draft recovery is locked"],
  ["unavailable", "Draft recovery is temporarily unavailable"],
] as const)("renders a localized recovery label for %s without an export action", (state, label) => {
  const attrs: Record<string, string> = {};
  const recovery = { textContent: "", setAttribute: (name: string, value: string) => { attrs[name] = value; } };
  renderDesktopRecoveryState(recovery, state, (key) => ({
    "office.recovery.available": "Draft ready to recover",
    "office.recovery.conflict": "Draft belongs to another document version",
    "office.recovery.blocked": "Draft recovery is blocked",
    "office.recovery.locked": "Draft recovery is locked",
    "office.recovery.unavailable": "Draft recovery is temporarily unavailable",
  }[key] ?? key));
  expect(attrs["data-recovery-state"]).toBe(state);
  expect(recovery.textContent).toBe(label);
});

it("maps every typed IPC recovery status and error to a safe view state", () => {
  expect(desktopRecoveryStateFromStatus("recovered")).toBe("available");
  expect(desktopRecoveryStateFromStatus("conflict")).toBe("conflict");
  expect(desktopRecoveryStateFromStatus("blocked")).toBe("blocked");
  expect(desktopRecoveryStateFromStatus("locked")).toBe("locked");
  expect(desktopRecoveryStateFromStatus("missing")).toBe("none");
  expect(desktopRecoveryStateFromStatus("ambiguous")).toBe("none");
  expect(desktopRecoveryStateFromError("storage_unavailable")).toBe("unavailable");
  expect(desktopRecoveryStateFromError("token_expired")).toBe("locked");
  expect(desktopRecoveryStateFromError("draft_recovery_locked")).toBe("locked");
});
