import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import LoginPage from "../app/(auth)/login/page";
import UniChatStartPage from "../app/(auth)/auth/unichat/page";
import { UniChatLoginGate } from "./unichat-login-gate";

const push = vi.fn();
const replace = vi.fn();
vi.mock("@uniwork/views/navigation", () => ({ useNavigation: () => ({ push, replace, searchParams: new URLSearchParams() }) }));
vi.mock("@uniwork/views/auth/post-auth-redirect", () => ({ useLoggedInDestination: () => async () => "/workspaces" }));
vi.mock("@uniwork/views/auth/login-view", () => ({ LoginView: () => <form data-testid="login-form" /> }));
vi.mock("@uniwork/core", () => ({ api: { workspaces: { list: vi.fn(async () => []) } } }));

const login = vi.fn(() => Promise.resolve());
const w = window as unknown as { desktopAPI?: unknown };
let root: Root;
let host: HTMLDivElement;

const button = () => host.querySelector("button");
const click = (el: HTMLElement | null) => act(async () => el?.click());
// The store's start-up refresh fails here (no server); its token drop must land
// before a test signs the store in, or it signs the store back out.
const settleSession = () => act(async () => useAuthStore.getState().initialize());

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  login.mockClear();
  push.mockClear();
  replace.mockClear();
  resetAuthStoreForTests();
  w.desktopAPI = { app: "unichat", session: { login } };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete w.desktopAPI;
});

describe("UniChatLoginGate", () => {
  it("waits for the button before opening the browser, then offers to reopen it", async () => {
    await act(async () => root.render(<UniChatLoginGate />));
    expect(login).not.toHaveBeenCalled();
    expect(host.querySelector("h1")?.textContent).toBe("Welcome to UniChat");
    expect(button()?.textContent).toBe("Sign in");

    await click(button());
    expect(login).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Finish signing in with the browser that just opened.");
    expect(button()?.textContent).toBe("Open browser again");

    await click(button());
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("shows the shell's refusal and keeps the sign-in button live", async () => {
    login.mockRejectedValueOnce(new Error("keyring unavailable"));
    await act(async () => root.render(<UniChatLoginGate />));
    await click(button());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not open the browser to sign in. Try again.");
    expect(button()?.textContent).toBe("Sign in");

    await click(button());
    expect(login).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("LoginPage", () => {
  it("inside the UniChat shell renders nothing until the session resolves, then the gate", async () => {
    act(() => root.render(<LoginPage />));
    expect(host.innerHTML).toBe("");
    await settleSession();
    expect(host.querySelector("h1")).not.toBeNull();
    expect(host.querySelector('[data-testid="login-form"]')).toBeNull();
    expect(login).not.toHaveBeenCalled();
  });

  it("leaves the gate and routes once the shell's token signs the store in", async () => {
    await act(async () => root.render(<LoginPage />));
    await settleSession();
    expect(host.querySelector("h1")).not.toBeNull();
    await act(async () => {
      setSessionUser({
        id: "u1", email: "a@b.c", display_name: "A", onboarded_at: "2026-01-01T00:00:00Z",
        email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
      });
    });
    expect(host.querySelector("h1")).toBeNull();
    expect(push).toHaveBeenCalledWith("/workspaces");
  });

  it("renders the form on the web", async () => {
    delete w.desktopAPI;
    await act(async () => root.render(<LoginPage />));
    expect(host.querySelector('[data-testid="login-form"]')).not.toBeNull();
    expect(login).not.toHaveBeenCalled();
  });
});

describe("UniChatStartPage", () => {
  it("renders nothing and hands over to /login", async () => {
    await act(async () => root.render(<UniChatStartPage />));
    expect(host.innerHTML).toBe("");
    expect(replace).toHaveBeenCalledWith("/login");
  });
});
