import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officeReleasesKeys, useOfficeReleases } from "./releases-hooks";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const manifest = (latest: string) => ({ schema: 1, channels: { dev: { latest, releases: [{ version: latest, notes_markdown: null, assets: [] }] } } });

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

describe("office releases hook", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    focusManager.setFocused(undefined);
  });

  it("keys the public manifest without any workspace", () => {
    expect(officeReleasesKeys.manifest()).toEqual(["office-releases", "manifest"]);
  });

  it("re-checks on focus only once ten minutes have passed, and never retries a failure", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(fetch).mockResolvedValueOnce(json(manifest("1.0.0-dev.1")));
    const { wrapper } = setup();
    const { result } = renderHook(() => useOfficeReleases(), { wrapper });
    await waitFor(() => expect(result.current.data?.channels.dev?.latest).toBe("1.0.0-dev.1"));
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    vi.mocked(fetch).mockResolvedValueOnce(json(manifest("1.0.0-dev.2")));
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(result.current.data?.channels.dev?.latest).toBe("1.0.0-dev.2"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not re-check on focus while the first read has failed, even after ten minutes; a manual refetch still reads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useOfficeReleases(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.isFetching).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(json(manifest("1.0.0-dev.1")));
    act(() => { void result.current.refetch(); });
    await waitFor(() => expect(result.current.data?.channels.dev?.latest).toBe("1.0.0-dev.1"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps re-checking on focus after a good read whose later re-check failed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(fetch).mockResolvedValueOnce(json(manifest("1.0.0-dev.1")));
    const { wrapper } = setup();
    const { result } = renderHook(() => useOfficeReleases(), { wrapper });
    await waitFor(() => expect(result.current.data?.channels.dev?.latest).toBe("1.0.0-dev.1"));
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    vi.mocked(fetch).mockResolvedValueOnce(json(manifest("1.0.0-dev.2")));
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(result.current.data?.channels.dev?.latest).toBe("1.0.0-dev.2"));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("surfaces a failed read as an error at once", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useOfficeReleases(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
