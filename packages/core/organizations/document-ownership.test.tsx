import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { documentKeys } from "../documents/keys";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import {
  BulkTransferFailure,
  memberDocumentOwnershipKeys,
  useBulkTransferMemberDocuments,
  useMemberDocumentOwnership,
} from "./document-ownership";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const batch = (over: Record<string, unknown>) => ({
  bulk_id: "b1",
  transferred: 0,
  skipped: { recipient_not_member: 0, self_restricted: 0 },
  has_more: false,
  cursor: "",
  ...over,
});

const bodyOf = (call: number) => JSON.parse(String((vi.mocked(fetch).mock.calls[call]![1] as RequestInit).body));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, invalidate, wrapper };
}

describe("member document ownership hooks", () => {
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

  it("useMemberDocumentOwnership counts, and an unreadable answer is an error rather than zero", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ user_id: "u1", total: 4, workspaces: [] }));
    const ok = renderHook(() => useMemberDocumentOwnership("acme", "u1"), { wrapper });
    await waitFor(() => expect(ok.result.current.data?.total).toBe(4));

    vi.mocked(fetch).mockResolvedValueOnce(json({ total: "x" }));
    const bad = renderHook(() => useMemberDocumentOwnership("acme", "u2"), { wrapper });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
  });

  it("useMemberDocumentOwnership stays idle while disabled", () => {
    const { wrapper } = setup();
    renderHook(() => useMemberDocumentOwnership("acme", "u1", false), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
    expect(memberDocumentOwnershipKeys.member("acme", "u1")).toEqual(["org-document-ownership", "acme", "u1"]);
  });

  it("walks every batch with the same bulk_id and the last cursor, summing the results", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json(batch({ transferred: 497, skipped: { recipient_not_member: 3, self_restricted: 0 }, has_more: true, cursor: "c1" })),
      )
      .mockResolvedValueOnce(json(batch({ transferred: 12, skipped: { recipient_not_member: 0, self_restricted: 2 } })));
    const onProgress = vi.fn();
    const { result } = renderHook(() => useBulkTransferMemberDocuments("acme"), { wrapper });
    let done;
    await act(async () => {
      done = await result.current.mutateAsync({ userId: "u1", toUserId: "u2", onProgress });
    });
    expect(done).toEqual({
      bulkId: "b1",
      cursor: "",
      transferred: 509,
      skipped: { recipient_not_member: 3, self_restricted: 2 },
    });
    expect(bodyOf(0)).toEqual({ to_user_id: "u2" });
    expect(bodyOf(1)).toEqual({ to_user_id: "u2", bulk_id: "b1", cursor: "c1" });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0]![0]).toMatchObject({ transferred: 497, cursor: "c1" });
  });

  it("invalidates every workspace's documents after EACH committed batch, not once at the end", async () => {
    const { wrapper, invalidate } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(batch({ transferred: 500, has_more: true, cursor: "c1" })))
      .mockImplementationOnce(async () => {
        await gate;
        return json(batch({ transferred: 1 }));
      });
    const { result } = renderHook(() => useBulkTransferMemberDocuments("acme"), { wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({ userId: "u1", toUserId: "u2" });
    });
    // The second batch is still in flight; the first has already been invalidated.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.all }));
    expect(invalidate.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(documentKeys.all))).toHaveLength(1);
    release();
    await act(async () => {
      await pending;
    });
    expect(invalidate.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(documentKeys.all))).toHaveLength(2);
  });

  it("a failing later batch rejects with what already committed, and a retry resumes from there", async () => {
    const { wrapper, invalidate } = setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(batch({ transferred: 500, has_more: true, cursor: "c1" })))
      .mockResolvedValueOnce(json({ error: { code: "internal", message: "x" } }, 500));
    const { result } = renderHook(() => useBulkTransferMemberDocuments("acme"), { wrapper });
    let failure: unknown;
    await act(async () => {
      failure = await result.current.mutateAsync({ userId: "u1", toUserId: "u2" }).catch((e: unknown) => e);
    });
    expect(failure).toBeInstanceOf(BulkTransferFailure);
    const progress = (failure as BulkTransferFailure).progress;
    expect(progress).toMatchObject({ bulkId: "b1", cursor: "c1", transferred: 500 });
    // The committed batch was already announced to open tabs.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.all });

    vi.mocked(fetch).mockResolvedValueOnce(json(batch({ transferred: 7 })));
    let done;
    await act(async () => {
      done = await result.current.mutateAsync({ userId: "u1", toUserId: "u2", resume: progress });
    });
    expect(bodyOf(2)).toEqual({ to_user_id: "u2", bulk_id: "b1", cursor: "c1" });
    expect(done).toMatchObject({ transferred: 507 });
  });

  it("an unreadable batch answer is a failure, never a silent stop", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ transferred: 3 }));
    const { result } = renderHook(() => useBulkTransferMemberDocuments("acme"), { wrapper });
    let failure: unknown;
    await act(async () => {
      failure = await result.current.mutateAsync({ userId: "u1", toUserId: "u2" }).catch((e: unknown) => e);
    });
    expect(failure).toBeInstanceOf(BulkTransferFailure);
    expect((failure as BulkTransferFailure).progress.transferred).toBe(0);
  });

  it("has_more without a moving cursor stops instead of looping forever", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(batch({ transferred: 5, has_more: true, cursor: "c1" })))
      .mockResolvedValueOnce(json(batch({ transferred: 5, has_more: true, cursor: "c1" })));
    const { result } = renderHook(() => useBulkTransferMemberDocuments("acme"), { wrapper });
    let failure: unknown;
    await act(async () => {
      failure = await result.current.mutateAsync({ userId: "u1", toUserId: "u2" }).catch((e: unknown) => e);
    });
    expect(failure).toBeInstanceOf(BulkTransferFailure);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
