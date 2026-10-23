import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { setSessionUser } from "../auth/hooks";
import { resetAuthStoreForTests } from "../auth/store";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { usePeoplePermissions } from "./use-resource-permissions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("usePeoplePermissions().decideClose", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
    setSessionUser({
      id: "u1",
      email: "a@b.c",
      display_name: "A",
      onboarded_at: "2026-10-01T00:00:00Z",
      email_verified_at: "2026-10-01T00:00:00Z",
      onboarding_questionnaire: {},
      locale: "vi",
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    resetAuthStoreForTests();
    setAccessToken(null);
  });

  it("is pending while the membership loads, then mirrors canCloseOrg", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user_id: "u1", role: "owner" }));
    const { result } = renderHook(() => usePeoplePermissions("acme"), { wrapper });
    expect(result.current.decideClose(false).reason).toBe("unknown");
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.decideClose(false).allowed).toBe(true);
    expect(result.current.decideClose(true).reason).toBe("organization_has_members");
  });

  it("refuses an admin", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user_id: "u1", role: "admin" }));
    const { result } = renderHook(() => usePeoplePermissions("acme"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.decideClose(false).reason).toBe("not_owner_role");
  });
});
