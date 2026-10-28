import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { ProviderHandoff, providerHint, useDropProviderHint } from "./provider-handoff";

type ProvidersQuery = { isPending: boolean; data?: Record<string, boolean> };
const state = vi.hoisted(() => ({ query: { isPending: true } as ProvidersQuery }));
vi.mock("@uniwork/core/auth", () => ({ useAuthProviders: () => state.query }));
vi.mock("@uniwork/views/auth/auth-callback-view", () => ({ AuthCallbackView: () => <p role="status">waiting</p> }));

const ALL_ON = { google: true, apple: true, apple_web: true, google_native: true };
const NEXT = "/auth/desktop/authorize?attempt_id=a1";

const loaded = (data: Record<string, boolean>): ProvidersQuery => ({ isPending: false, data });

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.query = { isPending: true };
  resetRuntimeConfig();
  configureRuntime({ apiUrl: "http://api.test" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = async (ui: React.ReactElement) => {
  await act(async () => {
    root.render(ui);
  });
};
const handoff = (leave: (url: string) => void, provider: "google" | "apple" = "apple") => (
  <ProviderHandoff provider={provider} next={NEXT} leave={leave}>
    <form data-testid="login-form" />
  </ProviderHandoff>
);

describe("providerHint", () => {
  it.each([
    ["provider=google", "google"],
    ["provider=apple&next=%2Fx", "apple"],
    // The server takes exactly these two spellings; so does the page.
    ["provider=Apple", null],
    ["provider=github", null],
    ["provider=", null],
    ["", null],
  ])("reads %j as %s", (query, expected) => {
    expect(providerHint(new URLSearchParams(query))).toBe(expected);
  });
});

describe("ProviderHandoff", () => {
  it("waits on the calm sign-in screen, never the form, while the providers load", async () => {
    const leave = vi.fn();
    await render(handoff(leave));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("waiting");
    expect(container.querySelector('[data-testid="login-form"]')).toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });

  it("leaves once for the provider's start route, carrying next", async () => {
    state.query = loaded(ALL_ON);
    const leave = vi.fn();
    await render(handoff(leave));
    await render(handoff(leave));
    expect(leave).toHaveBeenCalledExactlyOnceWith(
      "http://api.test/api/v1/auth/apple/start?next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Da1",
    );
    // Still the wait while the browser goes; no form to type into.
    expect(container.querySelector('[data-testid="login-form"]')).toBeNull();
  });

  it("starts Google the same way", async () => {
    state.query = loaded(ALL_ON);
    const leave = vi.fn();
    await render(handoff(leave, "google"));
    expect(leave).toHaveBeenCalledExactlyOnceWith(
      "http://api.test/api/v1/auth/google/start?next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Da1",
    );
  });

  it.each([
    ["the web has no Apple (only the iPhone's)", { google: true, apple: true, apple_web: false, google_native: true }],
    ["no provider at all", { google: false, apple: false, apple_web: false, google_native: false }],
  ])("shows the form when %s", async (_name, flags) => {
    state.query = loaded(flags);
    const leave = vi.fn();
    await render(handoff(leave));
    expect(container.querySelector('[data-testid="login-form"]')).not.toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });

  it("shows the form when the provider list cannot be read", async () => {
    state.query = { isPending: false, data: undefined };
    const leave = vi.fn();
    await render(handoff(leave));
    expect(container.querySelector('[data-testid="login-form"]')).not.toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("useDropProviderHint", () => {
  function Probe({ present }: { present: boolean }) {
    useDropProviderHint(present);
    return null;
  }

  it("takes provider out of the address bar and keeps the rest", async () => {
    window.history.replaceState(null, "", "/login?next=%2Fx&provider=apple#top");
    await render(<Probe present />);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/login?next=%2Fx#top");
  });

  it("leaves a URL without the hint alone", async () => {
    window.history.replaceState({ keep: 1 }, "", "/login?next=%2Fx");
    const spy = vi.spyOn(window.history, "replaceState");
    await render(<Probe present={false} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
