import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useOfficeDocsWebEnabled, useOfficeEnabled } from "./office-enabled";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const answer = (flags: Record<string, boolean>) => json({ flags, rum_sample_rate: 0, work_management_capabilities: {} });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

/** A promise the test settles by hand, so "in flight" is a state it can hold. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// The hook retries a failed read once (1 s default delay) before it reports `unknown`.
const SETTLE = { timeout: 4_000 };

describe("useOfficeEnabled", () => {
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

  it("reads loading until the organization's answer arrives, then its flags", async () => {
    const { wrapper } = setup();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useOfficeEnabled("org1", "docx"), { wrapper });
    expect(result.current.state).toBe("loading");
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("/api/v1/config?organization_id=org1");
    pending.resolve(answer({ office_engine: true, office_docx: true }));
    await waitFor(() => expect(result.current.state).toBe("on"));
  });

  it("reads off only from a settled answer that turns the format off", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(answer({ office_engine: true, office_docx: false }));
    const { result } = renderHook(() => useOfficeEnabled("org1", "docx"), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("off"));
  });

  it("reports a failed read as unknown, never as off", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockImplementation(async () => json({ error: "boom" }, 500));
    const { result } = renderHook(() => useOfficeEnabled("org1", "docx"), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("unknown"), SETTLE);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("does not cache a drifted answer as a settled one: it is unknown and the next read is asked again", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockImplementation(async () => json({ flags: "drifted" }));
    const { result } = renderHook(() => useOfficeEnabled("org1", "docx"), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("unknown"), SETTLE);
    expect(qc.getQueryData(["office-public-config", "org1"])).toBeUndefined();
    vi.mocked(fetch).mockImplementation(async () => answer({ office_engine: true }));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe("on"));
  });

  it("keeps the settled answer while a refetch is in flight and when it fails; only a new answer changes it", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(answer({ office_engine: true }));
    const { result } = renderHook(() => useOfficeEnabled("org1", "pptx"), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("on"));

    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    act(() => { void qc.invalidateQueries({ queryKey: ["office-public-config"] }); });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    expect(result.current.state).toBe("on");

    vi.mocked(fetch).mockImplementation(async () => json({ error: "boom" }, 503));
    pending.resolve(json({ error: "boom" }, 503));
    await waitFor(() => expect(qc.getQueryState(["office-public-config", "org1"])?.status).toBe("error"), SETTLE);
    expect(result.current.state).toBe("on");

    vi.mocked(fetch).mockImplementation(async () => answer({ office_engine: true, office_pptx: false }));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe("off"));
  });

  it("reads the host's global flags for a document without an organization", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useOfficeEnabled(undefined, "docx"), { wrapper });
    // No provider: office_engine reads its default (off) and nothing is fetched.
    expect(result.current.state).toBe("off");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("useOfficeDocsWebEnabled", () => {
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

  it("reads loading, then on only when the organization's answer turns office_docs_web on", async () => {
    const { wrapper } = setup();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useOfficeDocsWebEnabled("org1"), { wrapper });
    expect(result.current).toBe("loading");
    pending.resolve(answer({ office_engine: true, office_docs_web: true }));
    await waitFor(() => expect(result.current).toBe("on"));
  });

  it("reads off when the organization's answer says false, on when the flag is absent, and unknown on a failed read", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(answer({ office_engine: true, office_docs_web: false }));
    const { result } = renderHook(() => useOfficeDocsWebEnabled("org1"), { wrapper });
    await waitFor(() => expect(result.current).toBe("off"));

    const absent = setup();
    vi.mocked(fetch).mockResolvedValueOnce(answer({ office_engine: true }));
    const { result: defaulted } = renderHook(() => useOfficeDocsWebEnabled("org3"), { wrapper: absent.wrapper });
    await waitFor(() => expect(defaulted.current).toBe("on"));

    const failing = setup();
    vi.mocked(fetch).mockImplementation(async () => json({ error: "boom" }, 500));
    const { result: failed } = renderHook(() => useOfficeDocsWebEnabled("org2"), { wrapper: failing.wrapper });
    await waitFor(() => expect(failed.current).toBe("unknown"), SETTLE);
  });

  it("reads the host's global default (on) without an organization", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useOfficeDocsWebEnabled(undefined), { wrapper });
    expect(result.current).toBe("on");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
