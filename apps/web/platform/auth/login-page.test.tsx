import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LoginPage from "../../app/(auth)/login/page";

const state = vi.hoisted(() => ({
  search: "",
  uniChat: false,
  login: null as Record<string, unknown> | null,
  handoff: null as Record<string, unknown> | null,
}));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ status: "anon", user: null }) }));
vi.mock("@uniwork/core", () => ({ api: { workspaces: { list: async () => [] } } }));
vi.mock("@uniwork/views/navigation", () => ({
  useNavigation: () => ({ searchParams: new URLSearchParams(state.search), push: vi.fn() }),
}));
vi.mock("@uniwork/views/auth/post-auth-redirect", () => ({ useLoggedInDestination: () => async () => "/workspaces" }));
vi.mock("@uniwork/views/auth/login-view", () => ({
  LoginView: (props: Record<string, unknown>) => {
    state.login = props;
    return <form data-testid="login-form" />;
  },
}));
vi.mock("../desktop-host", () => ({ useIsUniChatHost: () => state.uniChat }));
vi.mock("../unichat-login-gate", () => ({ UniChatLoginGate: () => <p data-testid="unichat-gate" /> }));
vi.mock("./provider-handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./provider-handoff")>()),
  ProviderHandoff: (props: Record<string, unknown>) => {
    state.handoff = props;
    return <p data-testid="handoff" />;
  },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.search = "";
  state.uniChat = false;
  state.login = null;
  state.handoff = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const open = async (query: string) => {
  state.search = query;
  window.history.replaceState(null, "", `/login?${query}`);
  await act(async () => {
    root.render(<LoginPage />);
  });
};
const NEXT = "next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Da1";

it("hands an app's provider button to the hand-off with next, and drops the hint from the URL", async () => {
  await open(`${NEXT}&provider=apple`);
  expect(state.handoff).toMatchObject({ provider: "apple", next: "/auth/desktop/authorize?attempt_id=a1" });
  expect(window.location.search).toBe(`?${NEXT}`);
});

it.each(["provider=github", "provider=Apple", "provider="])("ignores %s but still drops it from the URL", async (hint) => {
  await open(`${NEXT}&${hint}`);
  expect(state.handoff).toBeNull();
  expect(container.querySelector('[data-testid="login-form"]')).not.toBeNull();
  expect(window.location.search).toBe(`?${NEXT}`);
});

it("never follows a hint inside the UniChat shell", async () => {
  state.uniChat = true;
  await open(`${NEXT}&provider=google`);
  expect(state.handoff).toBeNull();
  expect(container.querySelector('[data-testid="unichat-gate"]')).not.toBeNull();
});

it("passes the provider's error code to the form as it came, for the one table to read", async () => {
  await open(`error=apple_denied&${NEXT}`);
  expect(state.login).toMatchObject({ redirectError: "apple_denied", next: "/auth/desktop/authorize?attempt_id=a1" });
});
