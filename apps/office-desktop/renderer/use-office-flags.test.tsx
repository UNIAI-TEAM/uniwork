/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { RendererBridge } from "./app";
import { useOfficeFlags } from "./use-office-flags";

const base = { enabled: true, sessionGeneration: "session_1234", accountKey: "a", organizationId: "org-1", reload: 0 };

function bridgeWith(answer: (organizationId: string, call: number) => Promise<unknown>) {
  const call = vi.fn(async (_channel: string, payload: unknown) => answer((payload as { organizationId: string }).organizationId, call.mock.calls.length));
  return { bridge: { call } as unknown as RendererBridge, call };
}

it("keeps the previous answer while a reload is in flight and when the reload fails", async () => {
  let pending: (() => void) | undefined;
  const { bridge, call } = bridgeWith((_org, count) => count === 1
    ? Promise.resolve({ flags: { office_engine: true } })
    : new Promise((_resolve, reject) => { pending = () => reject(new Error("offline")); }));
  const { result, rerender } = renderHook((props) => useOfficeFlags(bridge, props), { initialProps: base });
  await waitFor(() => expect(result.current.allows("docx")).toBe(true));
  rerender({ ...base, reload: 1 });
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  expect(result.current.allows("docx")).toBe(true);
  await act(async () => { pending?.(); await Promise.resolve(); });
  await waitFor(() => expect(call.mock.calls.length).toBeGreaterThanOrEqual(3));
  expect(result.current.allows("docx")).toBe(true);
});

it("drops the answer when the account or the organization changes, and asks for the new organization", async () => {
  const { bridge, call } = bridgeWith((org) => org === "org-1" ? Promise.resolve({ flags: { office_engine: true } }) : new Promise(() => undefined));
  const { result, rerender } = renderHook((props) => useOfficeFlags(bridge, props), { initialProps: base });
  await waitFor(() => expect(result.current.allows("docx")).toBe(true));
  rerender({ ...base, organizationId: "org-2" });
  expect(result.current.allows("docx")).toBe(false);
  expect(result.current.flags).toBeNull();
  await waitFor(() => expect(call).toHaveBeenLastCalledWith("desktop:public-config", { sessionGeneration: "session_1234", organizationId: "org-2" }));
  rerender({ ...base, accountKey: "b" });
  expect(result.current.allows("docx")).toBe(false);
});

it("gives up waiting for an in-flight fetch after a short while and stays closed", async () => {
  vi.useFakeTimers();
  try {
    const { bridge } = bridgeWith(() => new Promise(() => undefined));
    const { result } = renderHook(() => useOfficeFlags(bridge, base));
    let done = false;
    void result.current.settled().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(2_900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    expect(result.current.allows("docx")).toBe(false);
  } finally { vi.useRealTimers(); }
});
