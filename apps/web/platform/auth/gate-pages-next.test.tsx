import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GetStartedPage from "../../app/(auth)/get-started/page";
import InvitationsPage from "../../app/(auth)/invitations/page";
import OnboardingPage from "../../app/(auth)/onboarding/page";
import RegisterPage from "../../app/(auth)/register/page";
import VerifyPage from "../../app/(auth)/verify/page";

/**
 * Spec §4.2: `next` survives the register, verify and onboarding gates. Each
 * page reads it, sanitizes it, carries it on every way off the screen, and
 * hands it to the resolver (or goes to it) once its gate is behind the person.
 */
type GateUser = { email_verified_at: string | null; onboarded_at: string | null };
const state = vi.hoisted(() => ({
  status: "authed" as string,
  user: null as GateUser | null,
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
  resolve: vi.fn(),
  views: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ status: state.status, user: state.user }) }));
vi.mock("@uniwork/core", () => ({ api: { workspaces: { list: async () => [] } } }));
vi.mock("@uniwork/core/organizations", () => ({ useOrganizations: () => ({ data: [], isFetched: true }) }));
vi.mock("@uniwork/core/workspaces", () => ({ useWorkspaces: () => ({ data: [], isFetched: true }) }));
vi.mock("@uniwork/core/paths", async (importOriginal) => {
  const original = await importOriginal<typeof import("@uniwork/core/paths")>();
  return {
    ...original,
    useHasOnboarded: () => state.user?.onboarded_at != null,
    usePendingAuthStep: () => original.pendingAuthStep(state.user),
  };
});
vi.mock("@uniwork/views/navigation", () => ({
  useNavigation: () => ({ searchParams: new URLSearchParams(state.search), push: state.push, replace: state.replace }),
}));
vi.mock("@uniwork/views/auth/post-auth-redirect", () => ({ useLoggedInDestination: () => state.resolve }));
// The views record their props; each test drives the callbacks itself.
vi.mock("@uniwork/views/auth/register-view", () => ({
  RegisterView: (props: Record<string, unknown>) => {
    state.views.register = props;
    return null;
  },
}));
vi.mock("@uniwork/views/auth/verify-email-view", () => ({
  VerifyEmailView: (props: Record<string, unknown>) => {
    state.views.verify = props;
    return null;
  },
}));
vi.mock("@uniwork/views/workspace/invitations-view", () => ({ InvitationsView: () => null }));
vi.mock("@uniwork/views/onboarding/no-organization-view", () => ({ NoOrganizationView: () => null }));
vi.mock("@uniwork/views/onboarding/onboarding-flow", () => ({
  OnboardingFlow: (props: Record<string, unknown>) => {
    state.views.onboarding = props;
    return null;
  },
}));

const NEXT = "/invite/tok";
const UNVERIFIED: GateUser = { email_verified_at: null, onboarded_at: null };
const VERIFIED: GateUser = { email_verified_at: "2026-10-01T00:00:00Z", onboarded_at: null };
const ONBOARDED: GateUser = { email_verified_at: "2026-10-01T00:00:00Z", onboarded_at: "2026-10-01T00:00:00Z" };
const SESSION = { access_token: "t", user: UNVERIFIED };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.status = "authed";
  state.user = null;
  state.search = `next=${encodeURIComponent(NEXT)}`;
  state.push.mockReset();
  state.replace.mockReset();
  state.resolve.mockReset();
  state.resolve.mockResolvedValue("/somewhere");
  state.views = {};
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
const call = async (fn: unknown, ...args: unknown[]) => {
  await act(async () => {
    await (fn as (...a: unknown[]) => unknown)(...args);
  });
};

describe("/register", () => {
  it("hands next to the view and to the resolver after sign-up", async () => {
    await render(<RegisterPage />);
    expect(state.views.register?.next).toBe(NEXT);
    await call(state.views.register?.onSuccess, SESSION);
    expect(state.resolve).toHaveBeenCalledWith(UNVERIFIED, [], NEXT);
    expect(state.push).toHaveBeenCalledWith("/somewhere");
  });

  it("drops a next that leaves the site", async () => {
    state.search = "next=https%3A%2F%2Fevil.example";
    await render(<RegisterPage />);
    expect(state.views.register?.next).toBeNull();
  });
});

describe("/verify", () => {
  it("goes on with next once the code is accepted", async () => {
    state.user = UNVERIFIED;
    await render(<VerifyPage />);
    await call(state.views.verify?.onSuccess, VERIFIED);
    expect(state.resolve).toHaveBeenCalledWith(VERIFIED, [], NEXT);
    expect(state.push).toHaveBeenCalledWith("/somewhere");
  });

  it("moves an already verified account on, with next", async () => {
    state.user = VERIFIED;
    await render(<VerifyPage />);
    expect(state.resolve).toHaveBeenCalledWith(VERIFIED, [], NEXT);
    expect(state.replace).toHaveBeenCalledWith("/somewhere");
  });

  it("keeps next when the session is gone", async () => {
    state.status = "anon";
    await render(<VerifyPage />);
    expect(state.replace).toHaveBeenCalledWith("/login?next=%2Finvite%2Ftok");
  });
});

describe("/onboarding", () => {
  it("sends an unverified account to /verify with next", async () => {
    state.user = UNVERIFIED;
    await render(<OnboardingPage />);
    expect(state.replace).toHaveBeenCalledWith("/verify?next=%2Finvite%2Ftok");
  });

  it("goes to next once onboarding completes, not to the new workspace", async () => {
    state.user = VERIFIED;
    await render(<OnboardingPage />);
    await call(state.views.onboarding?.onComplete, { organization_slug: "acme", slug: "team" });
    expect(state.push).toHaveBeenCalledWith(NEXT);
  });

  it("lands in the new workspace when there is no next", async () => {
    state.search = "";
    state.user = VERIFIED;
    await render(<OnboardingPage />);
    await call(state.views.onboarding?.onComplete, { organization_slug: "acme", slug: "team" });
    expect(state.push).toHaveBeenCalledWith("/acme/team/tasks");
  });

  it("sends an account that already finished onboarding on to next", async () => {
    state.user = ONBOARDED;
    await render(<OnboardingPage />);
    expect(state.replace).toHaveBeenCalledWith(NEXT);
  });
});

// The phone opens these two in an in-app browser that usually has no web session (spec §5.2).
describe("/invitations and /get-started", () => {
  it("send an anonymous visitor to sign in and back to the same page", async () => {
    state.status = "anon";
    await render(<InvitationsPage />);
    expect(state.replace).toHaveBeenCalledWith("/login?next=%2Finvitations");
    state.replace.mockReset();
    await render(<GetStartedPage />);
    expect(state.replace).toHaveBeenCalledWith("/login?next=%2Fget-started");
  });

  it("bring an unverified account back to the invitations once its address is verified", async () => {
    state.user = UNVERIFIED;
    await render(<InvitationsPage />);
    expect(state.replace).toHaveBeenCalledWith("/verify?next=%2Finvitations");
  });
});
