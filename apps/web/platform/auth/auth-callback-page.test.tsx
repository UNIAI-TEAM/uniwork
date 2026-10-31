import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../../app/auth/callback/page";

const state = vi.hoisted(() => ({
  status: "loading" as string,
  user: null as { email_verified_at: string | null; onboarded_at: string | null } | null,
  search: "",
  replace: vi.fn(),
  resolve: vi.fn(),
  announce: vi.fn(),
}));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ status: state.status, user: state.user }) }));
vi.mock("@uniwork/core", () => ({ api: { workspaces: { list: async () => [] } } }));
vi.mock("@uniwork/views/navigation", () => ({
  useNavigation: () => ({ searchParams: new URLSearchParams(state.search), replace: state.replace }),
}));
vi.mock("@uniwork/views/auth/post-auth-redirect", () => ({ useLoggedInDestination: () => state.resolve }));
vi.mock("@uniwork/views/auth/session-notices", () => ({ useSessionNotices: () => state.announce }));
vi.mock("@uniwork/views/auth/auth-callback-view", () => ({ AuthCallbackView: () => <p>waiting</p> }));

const VERIFIED = { email_verified_at: "2026-10-01T00:00:00Z", onboarded_at: "2026-10-01T00:00:00Z" };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.status = "loading";
  state.user = null;
  state.search = "";
  state.replace.mockReset();
  state.resolve.mockReset();
  state.announce.mockReset();
  window.history.replaceState(null, "", "/auth/callback");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const renderPage = async () => {
  await act(async () => {
    root.render(<Page />);
  });
};

it("sends a browser that arrived without a session back to login, keeping next", async () => {
  state.status = "anon";
  state.search = "next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Da1";
  await renderPage();
  expect(state.replace).toHaveBeenCalledWith(
    "/login?next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Da1&error=sign_in_failed",
  );
});

it("never names a provider when the sign-in did not finish", async () => {
  state.status = "anon";
  await renderPage();
  expect(state.replace).toHaveBeenCalledWith("/login?error=sign_in_failed");
});

it("drops an unsafe next instead of following it", async () => {
  state.status = "anon";
  state.search = "next=%2F%2Fevil.example";
  await renderPage();
  expect(state.replace).toHaveBeenCalledWith("/login?error=sign_in_failed");
});

it("says a reclaimed account once the session is real, and takes the flag out of the address bar", async () => {
  state.search = "reclaimed=1&next=%2Facme%2Fteam";
  window.history.replaceState(null, "", "/auth/callback?reclaimed=1&next=%2Facme%2Fteam");
  await renderPage();
  expect(window.location.search).toBe("?next=%2Facme%2Fteam");
  // Not yet: the sign-in may still fail, and then nothing was taken back.
  expect(state.announce).not.toHaveBeenCalled();

  state.status = "authed";
  state.user = VERIFIED;
  state.resolve.mockResolvedValue("/acme/team/tasks");
  await renderPage();
  await renderPage();
  expect(state.announce).toHaveBeenCalledTimes(1);
  expect(state.announce).toHaveBeenCalledWith({ reclaimed: true });
  // `next` rides through whatever gate the account still owes.
  expect(state.resolve).toHaveBeenLastCalledWith(VERIFIED, [], "/acme/team");
  expect(state.replace).toHaveBeenLastCalledWith("/acme/team/tasks");
});

it("says nothing for an ordinary provider sign-in", async () => {
  state.status = "authed";
  state.user = VERIFIED;
  state.resolve.mockResolvedValue("/acme/team/tasks");
  await renderPage();
  expect(state.announce).not.toHaveBeenCalled();
  expect(state.replace).toHaveBeenCalledWith("/acme/team/tasks");
});
