/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RendererBridge } from "./app";
import { useFlagGatedTabs, useOfficeFlags, type ReopenRefused } from "./use-office-flags";
import type { CloudReopen, TabDocument, useDocumentTabs } from "./tabs/use-document-tabs";

const base = { enabled: true, sessionGeneration: "session_1234", accountKey: "a", organizationId: "org-1", reload: 0 };

function bridgeWith(answer: (organizationId: string, call: number) => Promise<unknown>) {
  const call = vi.fn(async (_channel: string, payload: unknown) => answer((payload as { organizationId: string }).organizationId, call.mock.calls.length));
  return { bridge: { call } as unknown as RendererBridge, call };
}

afterEach(() => { vi.useRealTimers(); });

it("keeps the previous answer while a reload is in flight and when the reload fails", async () => {
  let pending: (() => void) | undefined;
  const { bridge, call } = bridgeWith((_org, count) => count === 1
    ? Promise.resolve({ flags: { office_engine: true } })
    : new Promise((_resolve, reject) => { pending = () => reject(new Error("offline")); }));
  const { result, rerender } = renderHook((props) => useOfficeFlags(bridge, props), { initialProps: base });
  await waitFor(() => expect(result.current.status("docx", "org-1")).toBe("on"));
  rerender({ ...base, reload: 1 });
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  expect(result.current.status("docx", "org-1")).toBe("on");
  await act(async () => { pending?.(); await Promise.resolve(); });
  await waitFor(() => expect(call.mock.calls.length).toBeGreaterThanOrEqual(3));
  expect(result.current.status("docx", "org-1")).toBe("on");
});

it("tells a format switched off from an answer that is not known yet", async () => {
  const { bridge } = bridgeWith(() => Promise.resolve({ flags: { office_engine: true, office_pptx: false } }));
  const { result } = renderHook(() => useOfficeFlags(bridge, base));
  expect(result.current.status("pptx", "org-1")).toBe("unknown");
  await waitFor(() => expect(result.current.status("pptx", "org-1")).toBe("off"));
  expect(result.current.status("docx", "org-1")).toBe("on");
});

it("binds the answer to the document's organization and fails closed for another one", async () => {
  const { bridge } = bridgeWith(() => Promise.resolve({ flags: { office_engine: true } }));
  const { result } = renderHook(() => useOfficeFlags(bridge, base));
  await waitFor(() => expect(result.current.status("docx", "org-1")).toBe("on"));
  // A document fetched under another organization (an org switch during its open) is not judged by this answer.
  expect(result.current.status("docx", "org-2")).toBe("unknown");
});

it("drops the answer when the account or the organization changes, and asks for the new organization", async () => {
  const { bridge, call } = bridgeWith((org) => org === "org-1" ? Promise.resolve({ flags: { office_engine: true } }) : new Promise(() => undefined));
  const { result, rerender } = renderHook((props) => useOfficeFlags(bridge, props), { initialProps: base });
  await waitFor(() => expect(result.current.status("docx", "org-1")).toBe("on"));
  rerender({ ...base, organizationId: "org-2" });
  expect(result.current.status("docx", "org-2")).toBe("unknown");
  expect(result.current.flags).toBeNull();
  await waitFor(() => expect(call).toHaveBeenLastCalledWith("desktop:public-config", { sessionGeneration: "session_1234", organizationId: "org-2" }));
  rerender({ ...base, accountKey: "b" });
  expect(result.current.status("docx", "org-1")).toBe("unknown");
});

it("gives up waiting for an in-flight fetch after a short while and stays closed", async () => {
  vi.useFakeTimers();
  const { bridge } = bridgeWith(() => new Promise(() => undefined));
  const { result } = renderHook(() => useOfficeFlags(bridge, base));
  let done = false;
  void result.current.settled().then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(2_900);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(200);
  expect(done).toBe(true);
  expect(result.current.status("docx", "org-1")).toBe("unknown");
});

it("asks again after the immediate retry fails: later with backoff, at once on focus or back online, and before an open", async () => {
  vi.useFakeTimers();
  let up = false;
  const { bridge, call } = bridgeWith(() => up ? Promise.resolve({ flags: { office_engine: true } }) : Promise.reject(new Error("offline")));
  const { result } = renderHook(() => useOfficeFlags(bridge, base));
  const calls = () => call.mock.calls.length;
  await vi.advanceTimersByTimeAsync(0);
  expect(calls()).toBe(2); // the read and its one immediate retry

  await vi.advanceTimersByTimeAsync(9_900);
  expect(calls()).toBe(2);
  await vi.advanceTimersByTimeAsync(200);
  expect(calls()).toBe(4); // first backoff step: 10 s
  await vi.advanceTimersByTimeAsync(19_000);
  expect(calls()).toBe(4);
  await vi.advanceTimersByTimeAsync(1_100);
  expect(calls()).toBe(6); // second step: 20 s

  // Focus asks at once; so does online.
  await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); });
  expect(calls()).toBe(8);
  await act(async () => { window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(0); });
  expect(calls()).toBe(10);

  // A cloud open with no answer and nothing in flight asks once more, and this time it is answered.
  up = true;
  await act(async () => { await result.current.settled(); });
  expect(calls()).toBe(11);
  expect(result.current.status("docx", "org-1")).toBe("on");

  // Answered: neither the timer nor focus asks again.
  await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(calls()).toBe(11);
});

it("upgrades a gated tab from a fresh read once the answer allows its format, and keeps it read-only when the read fails", async () => {
  let answer: Record<string, boolean> = { office_engine: false };
  const { bridge } = bridgeWith(() => Promise.resolve({ flags: answer }));
  const tab = (id: string, format: "pptx" | "xlsx") => ({ id, format, data: { kind: "cloud", format, identity: { organizationId: "org-1", documentId: id } } as unknown as TabDocument });
  const live = { tabs: [tab("deck", "pptx"), tab("sheet", "xlsx")] };
  const upgradeCloud = vi.fn((_id: string, _fresh: CloudReopen) => true);
  const tabs = { current: { current: live }, upgradeCloud } as unknown as ReturnType<typeof useDocumentTabs>;
  const fresh = (id: string): CloudReopen => ({ bytes: { format: "pptx", dataBase64: id, checksum: "c" }, baseRevision: "7", baseVersionId: "3" });
  const reopen = vi.fn(async (doc: TabDocument) => doc.identity.documentId === "sheet" ? null : fresh(doc.identity.documentId));

  const { result, rerender } = renderHook((props) => {
    const flags = useOfficeFlags(bridge, props);
    return useFlagGatedTabs(tabs, flags, reopen);
  }, { initialProps: base });
  act(() => { result.current("deck"); result.current("sheet"); });
  await waitFor(() => expect(bridge.call).toHaveBeenCalled());
  expect(reopen).not.toHaveBeenCalled(); // the answer says off: nothing to upgrade

  answer = { office_engine: true };
  rerender({ ...base, reload: 1 });
  await waitFor(() => expect(upgradeCloud).toHaveBeenCalledTimes(1));
  expect(upgradeCloud).toHaveBeenCalledWith("deck", fresh("deck"));
  expect(reopen).toHaveBeenCalledTimes(2);

  // The sheet's read failed: it stays gated and the next answer tries it again (the deck is done).
  rerender({ ...base, reload: 2 });
  await waitFor(() => expect(reopen).toHaveBeenCalledTimes(3));
  expect(reopen.mock.calls[2]?.[0].identity.documentId).toBe("sheet");
});

it("retries a gated tab whose fresh read failed under an answered 'on': with backoff and at once on focus (R4)", async () => {
  vi.useFakeTimers();
  let answer: Record<string, boolean> = { office_engine: false };
  const { bridge } = bridgeWith(() => Promise.resolve({ flags: answer }));
  const tab = { id: "deck", format: "pptx", data: { kind: "cloud", format: "pptx", identity: { organizationId: "org-1", documentId: "deck" } } as unknown as TabDocument };
  const upgradeCloud = vi.fn((_id: string, _fresh: CloudReopen) => true);
  const tabs = { current: { current: { tabs: [tab] } }, upgradeCloud } as unknown as ReturnType<typeof useDocumentTabs>;
  const fresh: CloudReopen = { bytes: { format: "pptx", dataBase64: "deck", checksum: "c" }, baseRevision: "7", baseVersionId: "3" };
  let readable = false;
  const reopen = vi.fn(async () => (readable ? fresh : null));
  const { result, rerender } = renderHook((props) => useFlagGatedTabs(tabs, useOfficeFlags(bridge, props), reopen), { initialProps: base });
  act(() => { result.current("deck"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });

  answer = { office_engine: true };
  rerender({ ...base, reload: 1 });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(reopen).toHaveBeenCalledTimes(1);
  expect(upgradeCloud).not.toHaveBeenCalled();

  // No new answer arrives (the scope is answered), yet the read is asked again after the backoff.
  await act(async () => { await vi.advanceTimersByTimeAsync(9_900); });
  expect(reopen).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(reopen).toHaveBeenCalledTimes(2);

  // Focus asks at once, and a successful read upgrades the tab.
  readable = true;
  await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); });
  expect(reopen).toHaveBeenCalledTimes(3);
  expect(upgradeCloud).toHaveBeenCalledWith("deck", fresh);

  // Upgraded: nothing is asked again.
  await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(reopen).toHaveBeenCalledTimes(3);
});

it("drops a gated tab from the retry on a permanent answer, reports it once, and keeps backing off for the others (N1)", async () => {
  vi.useFakeTimers();
  const { bridge } = bridgeWith(() => Promise.resolve({ flags: { office_engine: true } }));
  const tab = (id: string) => ({ id, format: "pptx", data: { kind: "cloud", format: "pptx", identity: { organizationId: "org-1", documentId: id } } as unknown as TabDocument });
  const upgradeCloud = vi.fn((_id: string, _fresh: CloudReopen) => true);
  const tabs = { current: { current: { tabs: [tab("moved"), tab("flaky")] } }, upgradeCloud } as unknown as ReturnType<typeof useDocumentTabs>;
  const reopen = vi.fn(async (doc: TabDocument): Promise<CloudReopen | ReopenRefused | null> => (doc.identity.documentId === "moved" ? { permanent: "gone" } : null));
  const onPermanent = vi.fn();
  const { result } = renderHook(() => useFlagGatedTabs(tabs, useOfficeFlags(bridge, base), reopen, onPermanent));
  act(() => { result.current("moved"); result.current("flaky"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(onPermanent).toHaveBeenCalledExactlyOnceWith("moved", "gone");
  expect(reopen.mock.calls.map(([doc]) => doc.identity.documentId)).toEqual(["moved", "flaky"]);

  // Only the transient tab is asked again (10 s, then 20 s), at once on focus too.
  await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
  await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); });
  expect(reopen.mock.calls.map(([doc]) => doc.identity.documentId)).toEqual(["moved", "flaky", "flaky", "flaky"]);
  expect(onPermanent).toHaveBeenCalledTimes(1);
  expect(upgradeCloud).not.toHaveBeenCalled();
});

it("backs off each gated tab on its own count: a tab that keeps failing does not delay a newer one (R3-5)", async () => {
  vi.useFakeTimers();
  const { bridge } = bridgeWith(() => Promise.resolve({ flags: { office_engine: true } }));
  const tab = (id: string) => ({ id, format: "pptx", data: { kind: "cloud", format: "pptx", identity: { organizationId: "org-1", documentId: id } } as unknown as TabDocument });
  const upgradeCloud = vi.fn((_id: string, _fresh: CloudReopen) => true);
  const tabs = { current: { current: { tabs: [tab("old"), tab("late")] } }, upgradeCloud } as unknown as ReturnType<typeof useDocumentTabs>;
  const reopen = vi.fn(async (_doc: TabDocument): Promise<CloudReopen | ReopenRefused | null> => null);
  const reads = (id: string) => reopen.mock.calls.filter(([doc]) => doc.identity.documentId === id).length;
  const { result } = renderHook(() => useFlagGatedTabs(tabs, useOfficeFlags(bridge, base), reopen));
  act(() => { result.current("old"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  // "old" fails at 0 s, 10 s and 30 s: its next retry is 40 s away (t = 70 s).
  await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
  expect(reads("old")).toBe(3);

  // A newer tab starts its own count: its first failure retries after 10 s, whatever "old" has suffered.
  act(() => { result.current("late"); });
  await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); });
  expect(reads("late")).toBe(1);
  const oldAfterFocus = reads("old");
  await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
  expect(reads("late")).toBe(2);
  expect(reads("old")).toBe(oldAfterFocus);
  expect(upgradeCloud).not.toHaveBeenCalled();
});
