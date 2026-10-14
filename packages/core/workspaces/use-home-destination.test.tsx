import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { setSessionUser } from "../auth/hooks";
import { resetAuthStoreForTests } from "../auth/store";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useHomeDestination } from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ws = {
  id: "w1", slug: "team", name: "Team", organization_id: "o1",
  organization_slug: "acme", organization_name: "Acme",
};

/** Answer by path, so the order the two lists are fetched in does not matter. */
function serve(routes: Record<string, unknown>) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    return Promise.resolve(path in routes ? json(routes[path]) : json({ error: { code: "not_found" } }, 404));
  });
}

describe("useHomeDestination", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    resetAuthStoreForTests();
    setAccessToken(null);
  });

  const signIn = () =>
    setSessionUser({
      id: "u1",
      email: "a@b.c",
      display_name: "A",
      onboarded_at: "2026-10-01T00:00:00Z",
      email_verified_at: "2026-10-01T00:00:00Z",
      onboarding_questionnaire: {},
      locale: "vi",
    });

  it("asks for nothing while signed out", () => {
    const { result } = renderHook(() => useHomeDestination(), { wrapper });
    expect(result.current).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leads into the first workspace of an organization the user belongs to", async () => {
    signIn();
    serve({
      "/api/v1/workspaces": { workspaces: [ws] },
      "/api/v1/orgs": { organizations: [{ id: "o1", slug: "acme", name: "Acme", status: "active" }] },
    });
    const { result } = renderHook(() => useHomeDestination(), { wrapper });
    await waitFor(() => expect(result.current).toBe("/acme/team"));
  });

  it("leads to /get-started once the user belongs to no organization", async () => {
    signIn();
    // A closed organization's workspace may still be listed; it is not home.
    serve({ "/api/v1/workspaces": { workspaces: [ws] }, "/api/v1/orgs": { organizations: [] } });
    const { result } = renderHook(() => useHomeDestination(), { wrapper });
    await waitFor(() => expect(result.current).toBe("/get-started"));
  });
});
