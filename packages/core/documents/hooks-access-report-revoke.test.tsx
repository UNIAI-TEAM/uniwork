import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useRevokeReportGrant } from "./hooks-access-report-revoke";
import { documentKeys } from "./keys";

const noContent = () => new Response(null, { status: 204 });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, spy, wrapper };
}

const calledKeys = (spy: ReturnType<typeof setup>["spy"]) => spy.mock.calls.map((c) => c[0]?.queryKey);
const lastRequest = () => {
  const call = vi.mocked(fetch).mock.calls.at(-1)!;
  return { url: new URL(String(call[0])), method: (call[1] as RequestInit | undefined)?.method };
};

describe("useRevokeReportGrant (UNI-2039)", () => {
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

  it.each([
    ["share", "/api/v1/documents/d1/shares/g1"],
    ["link", "/api/v1/documents/d1/links/g1"],
    ["break_glass", "/api/v1/documents/d1/break-glass/g1"],
  ] as const)("calls the existing %s revoke route", async (kind, path) => {
    vi.mocked(fetch).mockResolvedValueOnce(kind === "break_glass" ? json({ status: "ok" }) : noContent());
    const { wrapper } = setup();
    const { result } = renderHook(() => useRevokeReportGrant("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ documentId: "d1", target: { kind, id: "g1" } });
    });
    const req = lastRequest();
    expect(req.method).toBe("DELETE");
    expect(req.url.pathname).toBe(path);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("invalidates the report root, the shares and the detail of that document once the server answers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(noContent());
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useRevokeReportGrant("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ documentId: "d1", target: { kind: "share", id: "g1" } });
    });
    const keys = calledKeys(spy);
    expect(keys).toContainEqual(documentKeys.accessReportRoot("w1"));
    expect(keys).toContainEqual(documentKeys.shares("w1", "d1"));
    expect(keys).toContainEqual(documentKeys.detail("w1", "d1"));
    expect(keys).not.toContainEqual(documentKeys.accessLogs("w1", "d1"));
  });

  it("also refreshes the access log after ending a break-glass grant", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useRevokeReportGrant("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ documentId: "d1", target: { kind: "break_glass", id: "g1" } });
    });
    expect(calledKeys(spy)).toContainEqual(documentKeys.accessLogs("w1", "d1"));
  });

  it.each([[{ nope: true }], [{ status: "failed" }], [null], ["str"]])(
    "fails and leaves the report alone when ending a break-glass grant answers 200 with %j",
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      const { spy, wrapper } = setup();
      const { result } = renderHook(() => useRevokeReportGrant("w1"), { wrapper });
      await act(async () => {
        await result.current
          .mutateAsync({ documentId: "d1", target: { kind: "break_glass", id: "g1" } })
          .catch(() => undefined);
      });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("never touches the report cache before the server answers, and not at all when refused", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "forbidden", message: "no" } }, 403));
    const { qc, spy, wrapper } = setup();
    const key = documentKeys.accessReport("w1", undefined, {});
    qc.setQueryData(key, { pages: ["kept"] });
    const { result } = renderHook(() => useRevokeReportGrant("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ documentId: "d1", target: { kind: "share", id: "g1" } }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(key)).toEqual({ pages: ["kept"] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a target of an unknown kind without calling the server", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRevokeReportGrant("w1"), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ documentId: "d1", target: { kind: "teleport", id: "g1" } as never })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).not.toHaveBeenCalled();
  });
});
