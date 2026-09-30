import { expect, it, vi } from "vitest";
import { mountDesktopRenderer } from "./index";
import type { DesktopSessionMetadata } from "../shared/ipc";

function documentAdapter() {
  const attrs: Record<string, string> = {};
  const buttons: Array<{ textContent: string | null; attrs: Record<string, string>; click: () => void }> = [];
  let pendingClick: () => void = () => undefined;
  const root = {
    textContent: "",
    setAttribute: (name: string, value: string) => { attrs[name] = value; },
    appendChild: (button: { textContent: string | null; setAttribute: (name: string, value: string) => void; addEventListener: (type: "click", listener: () => void) => void }) => {
      const entry = { textContent: button.textContent, attrs: {} as Record<string, string>, click: pendingClick };
      button.setAttribute = (name, value) => { entry.attrs[name] = value; };
      buttons.push(entry);
      return button;
    },
  };
  return { root, attrs, buttons, documentLike: { getElementById: (id: string) => id === "root" ? root : null, createElement: () => ({ textContent: "", setAttribute: () => undefined, addEventListener: (_type: "click", listener: () => void) => { pendingClick = listener; } }) } };
}

it("mounts signed-out login and switches to the shell on metadata events", async () => {
  const { root, attrs, buttons, documentLike } = documentAdapter();
  let sessionListener: ((metadata: { status: "signed-out" | "signed-in"; accountId?: string; deploymentId?: string }) => void) | undefined;
  const bridge = {
    call: vi.fn(async (channel: string) => channel === "desktop:auth-config" ? { clientId: "uniwork-office-dev", deploymentId: "lane" } : { status: "signed-out" }),
    onSessionChanged: (listener: typeof sessionListener) => { sessionListener = listener; return () => undefined; },
  } as never;
  await mountDesktopRenderer(documentLike, bridge);
  expect(attrs["data-login-state"]).toBe("signed-out");
  expect(buttons[0]?.textContent).toBe("Start login");
  sessionListener?.({ status: "signed-in", accountId: "account-1", deploymentId: "lane" });
  expect(attrs["data-host"]).toBe("office-desktop");
  expect(attrs["data-session-status"]).toBe("signed-in");
  expect(attrs["data-account-id"]).toBe("account-1");
});

it("renders pending, error, cancelled and login-required states through the same mount", async () => {
  const { root, attrs, buttons, documentLike } = documentAdapter();
  let sessionListener: ((metadata: DesktopSessionMetadata) => void) | undefined;
  const bridge = {
    call: vi.fn(async (channel: string) => {
      if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
      if (channel === "desktop:auth-start") throw new Error("browser unavailable");
      return { status: "signed-out" };
    }),
    onSessionChanged: (listener: (metadata: DesktopSessionMetadata) => void) => { sessionListener = listener; return () => undefined; },
  } as never;
  await mountDesktopRenderer(documentLike, bridge);
  expect(root.textContent).toContain("Sign in securely");
  buttons.at(-1)?.click();
  expect(attrs["data-login-state"]).toBe("pending");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(attrs["data-login-state"]).toBe("error");

  const cancelled = documentAdapter();
  const cancelBridge = {
    call: vi.fn(async (channel: string) => {
      if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
      if (channel === "desktop:auth-start") return { status: "pending", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" };
      return { status: "signed-out" };
    }),
    onSessionChanged: () => () => undefined,
  } as never;
  await mountDesktopRenderer(cancelled.documentLike, cancelBridge);
  cancelled.buttons.at(-1)?.click();
  expect(cancelled.attrs["data-login-state"]).toBe("pending");
  await new Promise((resolve) => setTimeout(resolve, 0));
  cancelled.buttons.at(-1)?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cancelled.attrs["data-login-state"]).toBe("cancelled");

  sessionListener?.({ status: "login-required" });
  expect(attrs["data-login-state"]).toBe("login-required");
});
