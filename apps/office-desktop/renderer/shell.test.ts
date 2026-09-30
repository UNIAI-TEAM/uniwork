import { expect, it } from "vitest";
import { DESKTOP_SHELL_PLACEHOLDER, renderDesktopShell } from "./shell";

it("renders the shared shell placeholder without privileged APIs", () => {
  const root = { textContent: "", setAttribute: (name: string, value: string) => { root.attrs[name] = value; }, attrs: {} as Record<string, string> };
  renderDesktopShell(root);
  expect(root.textContent).toBe(DESKTOP_SHELL_PLACEHOLDER);
  expect(root.attrs).toEqual({ "data-host": "office-desktop", "data-build": "unsigned-dev", "data-session-status": "signed-in" });
});
