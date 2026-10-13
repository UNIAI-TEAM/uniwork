import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import Page from "../../app/(auth)/auth/connect/authorize/page";

const state = vi.hoisted(() => ({
  status: "loading",
  query: "attempt=attempt-1",
  read: vi.fn(),
  decide: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ status: state.status }) }));
vi.mock("@uniwork/core", () => ({
  api: { connect: { getConnectConsent: (...args: unknown[]) => state.read(...args), decideConnectConsent: (...args: unknown[]) => state.decide(...args) } },
}));
vi.mock("@uniwork/views/navigation", () => ({ useNavigation: () => ({ searchParams: new URLSearchParams(state.query), replace: state.replace }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@uniwork/views/auth/connect-consent", () => ({
  ConnectConsentView: ({ consent, state: view, errorCode, onDecision }: { consent: { csrf_token: string } | null; state: string; errorCode?: string; onDecision: (decision: "approve" | "cancel", organizationId?: string) => Promise<void> }) => (
    <div>
      <div data-testid="consent-state">{view}</div>
      <div data-testid="csrf">{consent?.csrf_token ?? ""}</div>
      <div data-testid="error-code">{errorCode ?? ""}</div>
      <button type="button" onClick={() => void onDecision("approve", "o1")}>approve</button>
    </div>
  ),
}));

const assign = vi.fn();
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.status = "loading";
  state.query = "attempt=attempt-1";
  state.read.mockReset();
  state.decide.mockReset();
  state.replace.mockReset();
  assign.mockReset();
  vi.stubGlobal("location", { assign });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const renderPage = async () => {
  await act(async () => {
    root.render(<StrictMode><Page /></StrictMode>);
  });
};
const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent;
const pending = (csrf: string) => ({ attempt_id: "attempt-1", status: "pending", client: { client_id: "c1", name: "Claude", logo_uri: "", verified: true }, redirect_host: "claude.ai", scope: "read", organizations: [], csrf_token: csrf });

it("waits for the session, then reads the attempt exactly once even under StrictMode", async () => {
  await renderPage();
  expect(state.read).not.toHaveBeenCalled();
  state.status = "authed";
  state.read.mockResolvedValue(pending("t1"));
  await renderPage();
  expect(state.read).toHaveBeenCalledExactlyOnceWith("attempt-1");
  expect(text("csrf")).toBe("t1");
});

it("sends an anonymous arrival to login and back to the same attempt", async () => {
  state.status = "anon";
  await renderPage();
  expect(state.replace).toHaveBeenCalledWith("/login?next=%2Fauth%2Fconnect%2Fauthorize%3Fattempt%3Dattempt-1");
  expect(state.read).not.toHaveBeenCalled();
});

it("goes to login when the read answers 401", async () => {
  state.status = "authed";
  state.read.mockRejectedValue(new ApiError("unauthorized", "unauthorized", 401));
  await renderPage();
  expect(state.replace).toHaveBeenCalledWith("/login?next=%2Fauth%2Fconnect%2Fauthorize%3Fattempt%3Dattempt-1");
  expect(container.querySelector('[data-testid="consent-state"]')).toBeNull();
});

it.each([["approved", "approved"], ["cancelled", "cancelled"], ["expired", "expired"], ["gone", "expired"]])("shows an ended attempt (%s) as %s", async (status, expected) => {
  state.status = "authed";
  state.read.mockResolvedValue({ ...pending(""), status, client: null });
  await renderPage();
  expect(text("consent-state")).toBe(expected);
});

it.each([["attempt_expired"], ["client_unavailable"]])("shows a 410 %s as expired", async (code) => {
  state.status = "authed";
  state.read.mockRejectedValue(new ApiError("gone", code, 410));
  await renderPage();
  expect(text("consent-state")).toBe("expired");
});

it("reports malformed consent as an error rather than an expired request", async () => {
  state.status = "authed";
  state.read.mockResolvedValue(null);
  await renderPage();
  expect(text("consent-state")).toBe("error");
});

it("shows the error code the server sent back, without reading an attempt", async () => {
  state.status = "authed";
  state.query = "error=invalid_client";
  await renderPage();
  expect(text("consent-state")).toBe("error");
  expect(text("error-code")).toBe("invalid_client");
  expect(state.read).not.toHaveBeenCalled();
});

it("reads again for a fresh token when the decision is refused as csrf_invalid, and approves with it", async () => {
  state.status = "authed";
  state.read.mockResolvedValueOnce(pending("stale")).mockResolvedValueOnce(pending("fresh"));
  state.decide
    .mockRejectedValueOnce(new ApiError("consent confirmation is invalid", "csrf_invalid", 400))
    .mockResolvedValueOnce({ status: "approved", redirect_to: "https://claude.ai/api/mcp/auth_callback?code=c" });
  await renderPage();
  expect(text("csrf")).toBe("stale");

  await act(async () => { container.querySelector("button")?.click(); });
  expect(state.decide).toHaveBeenNthCalledWith(1, "attempt-1", { decision: "approve", csrf_token: "stale", organization_id: "o1" });
  expect(state.read).toHaveBeenCalledTimes(2);
  expect(text("consent-state")).toBe("pending");
  expect(text("csrf")).toBe("fresh");
  expect(assign).not.toHaveBeenCalled();

  await act(async () => { container.querySelector("button")?.click(); });
  expect(state.decide).toHaveBeenNthCalledWith(2, "attempt-1", { decision: "approve", csrf_token: "fresh", organization_id: "o1" });
  expect(text("consent-state")).toBe("approved");
  expect(assign).toHaveBeenCalledExactlyOnceWith("https://claude.ai/api/mcp/auth_callback?code=c");
});

it("treats any other refused decision as an error and never navigates", async () => {
  state.status = "authed";
  state.read.mockResolvedValue(pending("t1"));
  state.decide.mockRejectedValue(new ApiError("forbidden", "forbidden", 403));
  await renderPage();
  await act(async () => { container.querySelector("button")?.click(); });
  expect(text("consent-state")).toBe("error");
  expect(state.read).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
});

it("does not follow a redirect that is not http(s)", async () => {
  state.status = "authed";
  state.read.mockResolvedValue(pending("t1"));
  state.decide.mockResolvedValue({ status: "approved", redirect_to: "javascript:alert(1)" });
  await renderPage();
  await act(async () => { container.querySelector("button")?.click(); });
  expect(text("consent-state")).toBe("error");
  expect(assign).not.toHaveBeenCalled();
});
