import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import {
  aiOfficeKeys,
  useAiCloudSearch,
  useAiCloudStatus,
  useAiCredentials,
  useDeleteAiCredential,
  useSaveAiCredential,
} from "./office-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("ai office hooks", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("keys carry the organization id", () => {
    expect(aiOfficeKeys.credentials("o1")).toEqual(["ai-office", "credentials", "o1"]);
    expect(aiOfficeKeys.cloud("o1")).not.toEqual(aiOfficeKeys.cloud("o2"));
  });

  it("queries stay idle without an org id", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAiCredentials(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("useAiCloudStatus reads the status for the org", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true }));
    const { result } = renderHook(() => useAiCloudStatus("o1"), { wrapper });
    await waitFor(() => expect(result.current.data?.enabled).toBe(true));
  });

  it("save and delete refresh the credential list", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ provider: "openai", key_hint: "…abcd" }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const save = renderHook(() => useSaveAiCredential("o1"), { wrapper });
    await act(async () => {
      await save.result.current.mutateAsync({ provider: "openai", body: { api_key: "k" } });
    });
    const del = renderHook(() => useDeleteAiCredential("o1"), { wrapper });
    await act(async () => {
      await del.result.current.mutateAsync("openai");
    });
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual([
      JSON.stringify(aiOfficeKeys.credentials("o1")),
      JSON.stringify(aiOfficeKeys.credentials("o1")),
    ]);
  });

  it("a cloud call refetches the credits line", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json({ results: [] }));
    const { result } = renderHook(() => useAiCloudSearch("o1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ query: "q", kind: "web" });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiOfficeKeys.cloud("o1") });
  });
});
