import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import LoginPage from "../app/(auth)/login/page";
import { UniChatLoginGate } from "./unichat-login-gate";

const push = vi.fn();
vi.mock("@uniwork/views/navigation", () => ({ useNavigation: () => ({ push, searchParams: new URLSearchParams() }) }));
vi.mock("@uniwork/views/auth/post-auth-redirect", () => ({ useLoggedInDestination: () => async () => "/workspaces" }));
vi.mock("@uniwork/views/auth/login-view", () => ({ LoginView: () => <form data-testid="login-form" /> }));
vi.mock("@uniwork/core", () => ({ api: { workspaces: { list: vi.fn(async () => []) } } }));

const login = vi.fn(() => Promise.resolve());
const w = window as unknown as { desktopAPI?: unknown };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  login.mockClear();
  push.mockClear();
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
  it("starts the shell's PKCE login once on mount and again from the button", async () => {
    await act(async () => root.render(<UniChatLoginGate />));
    expect(login).toHaveBeenCalledTimes(1);
    expect(host.querySelector("h1")?.textContent).toBe("Sign in to UniChat");

    const button = host.querySelector("button");
    expect(button?.textContent).toBe("Open the browser to sign in");
    await act(async () => button?.click());
    expect(login).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the shell's refusal and keeps the retry button live", async () => {
    login.mockRejectedValueOnce(new Error("keyring unavailable"));
    await act(async () => root.render(<UniChatLoginGate />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not open the browser to sign in. Try again.");

    await act(async () => host.querySelector("button")?.click());
    expect(login).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("LoginPage", () => {
  it("renders the gate instead of the form inside the UniChat shell", async () => {
    await act(async () => root.render(<LoginPage />));
    expect(host.querySelector('[data-testid="login-form"]')).toBeNull();
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("leaves the gate and routes once the shell's token signs the store in", async () => {
    await act(async () => root.render(<LoginPage />));
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
