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
vi.mock("@uniwork/views/auth/post-auth-redirect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/views/auth/post-auth-redirect")>()),
  useLoggedInDestination: () => async () => "/workspaces",
}));
vi.mock("@uniwork/views/auth/login-view", () => ({ LoginView: () => <form data-testid="login-form" /> }));
vi.mock("@uniwork/core", () => ({ api: { workspaces: { list: vi.fn(async () => []) } } }));

// GET /auth/providers, as the hook answers it: the gate reads `google` and `apple_web`.
const ALL = { google: true, apple: true, apple_web: true, google_native: false };
const providers = vi.hoisted(() => ({ value: { isPending: false, data: undefined as unknown } }));
vi.mock("@uniwork/core/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/core/auth")>()),
  useAuthProviders: () => providers.value,
}));

const login = vi.fn((_options?: { provider: string }) => Promise.resolve());
const w = window as unknown as { desktopAPI?: unknown };
let root: Root;
let host: HTMLDivElement;

const buttons = () => Array.from(host.querySelectorAll("button"));
const names = () => buttons().map((b) => b.textContent);
const named = (name: string) => buttons().find((b) => b.textContent === name) ?? null;
const button = () => named("Continue with email");
const click = (el: HTMLElement | null) => act(async () => el?.click());
const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
// The store's start-up refresh fails here (no server); its token drop must land
// before a test signs the store in, or it signs the store back out.
const settleSession = () => act(async () => useAuthStore.getState().initialize());

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  login.mockClear();
  providers.value = { isPending: false, data: ALL };
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
  it("leads with Google and Apple, then email, and opens nothing before a press", async () => {
    await act(async () => root.render(<UniChatLoginGate />));
    expect(login).not.toHaveBeenCalled();
    expect(host.querySelector("h1")?.textContent).toBe("Welcome to UniChat");
    expect(names()).toEqual(["Continue with Google", "Continue with Apple", "Continue with email"]);
    expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Sign in with Google or Apple");
    // "or", not the web's "or use email": the email way here is a pill, not a form.
    expect(Array.from(host.querySelectorAll("span")).some((span) => span.textContent === "or")).toBe(true);
  });

  it("sends the browser straight to the provider pressed, names it in the steps, and re-opens the same", async () => {
    await act(async () => root.render(<UniChatLoginGate />));
    await click(named("Continue with Apple"));
    expect(login).toHaveBeenLastCalledWith({ provider: "apple" });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Finish signing in with the browser that just opened.");
    const first = host.querySelector("ol li")?.textContent?.replace(/^\d/, "");
    expect(first).toBe("The browser opened the Apple sign-in page");
    // The pressed pill left the screen: focus is on the next likely press.
    expect(document.activeElement?.textContent).toBe("Open browser again");

    await click(named("Open browser again"));
    expect(login).toHaveBeenCalledTimes(2);
    expect(login).toHaveBeenLastCalledWith({ provider: "apple" });
  });

  it("email opens the UniWork sign-in page, and Cancel hands focus back to its pill", async () => {
    w.desktopAPI = { app: "unichat", appInfo: { version: "0.1.0-beta.2", os: "macos" }, session: { login } };
    await act(async () => root.render(<UniChatLoginGate />));
    const features = Array.from(host.querySelectorAll("ul li")).map((li) => li.textContent);
    expect(features).toEqual([
      "Direct messages, groups and every workspace's channels in one place",
      "Voice and video calls, and screen sharing",
      "UNI sums up your unread messages and calls",
    ]);
    expect(host.textContent).toContain("UniChat 0.1.0-beta.2");

    await click(button());
    expect(login).toHaveBeenLastCalledWith(undefined);
    // The drawn step numbers are decoration (the <ol> numbers them for a screen reader).
    const steps = Array.from(host.querySelectorAll("ol li")).map((li) => li.textContent?.replace(/^\d/, ""));
    expect(steps).toEqual([
      "The browser opened the UniWork sign-in page",
      'Choose "Allow desktop app" there',
      "Come back here: UniChat opens your conversations",
    ]);
    await click(named("Cancel"));
    expect(names()).toEqual(["Continue with Google", "Continue with Apple", "Continue with email"]);
    expect(document.activeElement).toBe(button());
  });

  it("keeps every pill inert while one opens the browser, the pressed one spinning", async () => {
    const opening = deferred();
    login.mockReturnValueOnce(opening.promise);
    await act(async () => root.render(<UniChatLoginGate />));
    await click(named("Continue with Google"));
    expect(buttons().map((b) => b.getAttribute("aria-disabled"))).toEqual(["true", "true", "true"]);
    expect(named("Continue with Google")?.querySelector(".animate-spin")).not.toBeNull();
    expect(named("Continue with Apple")?.querySelector(".animate-spin")).toBeNull();
    await click(named("Continue with Apple"));
    expect(login).toHaveBeenCalledOnce();
    await act(async () => opening.resolve());
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  it("stays on the steps while the browser re-opens, and a Cancel meanwhile is not undone", async () => {
    await act(async () => root.render(<UniChatLoginGate />));
    await click(named("Continue with Google"));
    const reopening = deferred();
    login.mockReturnValueOnce(reopening.promise);
    await click(named("Open browser again"));
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(named("Open browser again")?.getAttribute("aria-disabled")).toBe("true");
    await click(named("Cancel"));
    await act(async () => reopening.resolve());
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("Continue with Google");
  });

  it("a re-open the shell refuses says so and hands focus back to the way chosen", async () => {
    await act(async () => root.render(<UniChatLoginGate />));
    await click(named("Continue with Apple"));
    login.mockRejectedValueOnce(new Error("browser would not open"));
    await click(named("Open browser again"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Couldn't open the browser to sign in. Try again.");
    expect(document.activeElement?.textContent).toBe("Continue with Apple");
  });

  it("offers only what the deployment does: with no provider, email stands alone", async () => {
    providers.value = { isPending: false, data: { google: false, apple: true, apple_web: false, google_native: true } };
    await act(async () => root.render(<UniChatLoginGate />));
    expect(names()).toEqual(["Continue with email"]);
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(Array.from(host.querySelectorAll("span")).some((span) => span.textContent === "or")).toBe(false);
    // Alone, email is the primary.
    expect(named("Continue with email")?.className).toContain("bg-primary");
    providers.value = { isPending: false, data: { ...ALL, google: false } };
    await act(async () => root.render(<UniChatLoginGate />));
    expect(names()).toEqual(["Continue with Apple", "Continue with email"]);
    // Beside Apple it weighs what Apple weighs (Apple's HIG): an outline pill too.
    expect(named("Continue with email")?.className).toContain("border-input");
    expect(named("Continue with email")?.className).not.toContain("bg-primary");
  });

  it("holds the providers' space while they load, so email does not move", async () => {
    providers.value = { isPending: true, data: undefined };
    await act(async () => root.render(<UniChatLoginGate />));
    const held = host.querySelector('[data-slot="social-placeholder"]');
    expect(held?.getAttribute("aria-hidden")).toBe("true");
    expect(held?.children).toHaveLength(3);
    expect(names()).toEqual(["Continue with email"]);
  });

  it("shows the shell's refusal and keeps every way in live", async () => {
    login.mockRejectedValueOnce(new Error("keyring unavailable"));
    await act(async () => root.render(<UniChatLoginGate />));
    await click(named("Continue with Apple"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Couldn't open the browser to sign in. Try again.");
    expect(names()).toEqual(["Continue with Google", "Continue with Apple", "Continue with email"]);

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
