import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ContinuePage from "../../app/(auth)/auth/continue/page";
import ForgotPasswordPage from "../../app/(auth)/forgot-password/page";
import ResetPasswordPage from "../../app/(auth)/reset-password/page";

/**
 * The choice screen's page (spec §4.3) and the two pages "Quên mật khẩu?"
 * crosses on the way back to a link (§4.4): each reads its query, hands the
 * view what it needs, and goes on through the resolver with `next`.
 */
const state = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
  resolve: vi.fn(async (..._args: unknown[]) => "/acme/team"),
  views: {} as Record<string, Record<string, unknown>>,
}));
vi.mock("@uniwork/core", () => ({ api: { workspaces: { list: async () => [{ id: "w1" }] } } }));
vi.mock("@uniwork/views/navigation", () => ({
  useNavigation: () => ({ searchParams: new URLSearchParams(state.search), replace: state.replace, push: state.push }),
}));
vi.mock("@uniwork/views/auth/post-auth-redirect", () => ({ useLoggedInDestination: () => state.resolve }));
vi.mock("@uniwork/views/auth/continue-view", () => ({
  ContinueView: (props: Record<string, unknown>) => {
    state.views.continue = props;
    return null;
  },
}));
vi.mock("@uniwork/views/auth/forgot-password-view", () => ({
  ForgotPasswordView: (props: Record<string, unknown>) => {
    state.views.forgot = props;
    return null;
  },
}));
vi.mock("@uniwork/views/auth/reset-password-view", () => ({
  ResetPasswordView: (props: Record<string, unknown>) => {
    state.views.reset = props;
    return null;
  },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.views = {};
  state.replace.mockReset();
  state.push.mockReset();
  state.resolve.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = async (page: React.ReactElement, query: string) => {
  state.search = query;
  await act(async () => {
    root.render(page);
  });
};
const USER = { id: "u1", email_verified_at: "2026-01-01T00:00:00Z", onboarded_at: "2026-01-01T00:00:00Z" };

it("hands the choice screen its sanitized next and step, and replaces it with the destination once done", async () => {
  await render(<ContinuePage />, "step=link&next=%2Finvite%2Ft1");
  expect(state.views.continue).toMatchObject({ next: "/invite/t1", step: "link" });
  await act(async () => {
    (state.views.continue!.onDone as (u: unknown) => void)(USER);
  });
  expect(state.resolve).toHaveBeenCalledWith(USER, [{ id: "w1" }], "/invite/t1");
  expect(state.replace).toHaveBeenCalledWith("/acme/team");
  expect(state.push).not.toHaveBeenCalled();
});

it.each([
  ["next=https%3A%2F%2Fevil.example&step=create", { next: null, step: null }],
  ["", { next: null, step: null }],
])("reads %s as no next and the choices", async (query, expected) => {
  await render(<ContinuePage />, query);
  expect(state.views.continue).toMatchObject(expected);
});

it("keeps next on the forgot-password page", async () => {
  await render(<ForgotPasswordPage />, "next=%2Fauth%2Fcontinue%3Fstep%3Dlink");
  expect(state.views.forgot).toMatchObject({ next: "/auth/continue?step=link" });
});

it("sends a reset that kept a pending link through the resolver to the link step", async () => {
  await render(<ResetPasswordPage />, "token=t1");
  await act(async () => {
    await (state.views.reset!.onSuccess as (s: unknown, n: string | null) => Promise<void>)({ user: USER }, "/auth/continue?step=link");
  });
  expect(state.resolve).toHaveBeenCalledWith(USER, [{ id: "w1" }], "/auth/continue?step=link");
  expect(state.push).toHaveBeenCalledWith("/acme/team");
});
