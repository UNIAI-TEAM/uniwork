import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOfficeHandoffStore } from "@uniwork/core/ai/office-handoff";
import type { DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import type { InitAck } from "@uniwork/core/office/docs-frame-protocol";
import { useFrameAiHandoff } from "./use-frame-ai-handoff";

const DOC = "doc-1";
const ack = (aiStart: boolean) => ({ capabilities: { aiStart } }) as unknown as InitAck;
const fakeHost = (startAi: DocsFrameHost["startAi"] = vi.fn(async () => ({ queued: true as const }))) =>
  ({ startAi }) as unknown as DocsFrameHost;
const status = () => useOfficeHandoffStore.getState().byDocument[DOC]?.status;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => { useOfficeHandoffStore.getState().reset(); });

describe("useFrameAiHandoff", () => {
  it("sends the queued job once, after the open and not before", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "Soạn báo cáo");
    const startAi = vi.fn(async () => ({ queued: true as const }));
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    const host = fakeHost(startAi);
    result.current.attach(host, ack(true), false);
    expect(startAi).not.toHaveBeenCalled();
    result.current.documentOpened(host);
    await flush();
    expect(startAi).toHaveBeenCalledTimes(1);
    expect(startAi).toHaveBeenCalledWith({ handoffId: "h1", text: "Soạn báo cáo", displayText: "Soạn báo cáo" });
    expect(status()).toBe("sent");
    // A remount (a new handshake with a new host) finds the entry consumed.
    result.current.detach();
    const again = fakeHost(startAi);
    result.current.attach(again, ack(true), false);
    result.current.documentOpened(again);
    await flush();
    expect(startAi).toHaveBeenCalledTimes(1);
  });

  it("refuses without sending when the frame did not claim aiStart", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const startAi = vi.fn(async () => ({ queued: true as const }));
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    const host = fakeHost(startAi);
    result.current.attach(host, ack(false), false);
    result.current.documentOpened(host);
    await flush();
    expect(startAi).not.toHaveBeenCalled();
    expect(status()).toBe("refused");
  });

  it("marks the job refused when the frame rejects it", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    const host = fakeHost(vi.fn(async () => { throw new Error("unsupported"); }));
    result.current.attach(host, ack(true), false);
    result.current.documentOpened(host);
    await flush();
    expect(status()).toBe("refused");
  });

  it("does nothing for a document with no entry", async () => {
    const startAi = vi.fn(async () => ({ queued: true as const }));
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    const host = fakeHost(startAi);
    result.current.attach(host, ack(true), false);
    result.current.documentOpened(host);
    await flush();
    expect(startAi).not.toHaveBeenCalled();
    expect(useOfficeHandoffStore.getState().byDocument).toEqual({});
  });

  it("follows the frame's AI runs only for a job the frame was sent", async () => {
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    result.current.onAiRun("running");
    expect(useOfficeHandoffStore.getState().byDocument).toEqual({});
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    // A run before the send leaves the job pending, so the send still takes it.
    result.current.onAiRun("running");
    expect(status()).toBe("pending");
    useOfficeHandoffStore.getState().take(DOC);
    result.current.onAiRun("running");
    expect(status()).toBe("running");
    result.current.onAiRun("idle");
    expect(status()).toBe("idle");
    result.current.onAiRun("running");
    expect(status()).toBe("running");
  });

  it("never turns a refused job back into a running one", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    const host = fakeHost();
    result.current.attach(host, ack(false), false);
    result.current.documentOpened(host);
    expect(status()).toBe("refused");
    result.current.onAiRun("running");
    result.current.onAiRun("idle");
    expect(status()).toBe("refused");
  });

  it("leaves the job pending through a locked-out handshake and sends it from the next one", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const startA = vi.fn(async () => ({ queued: true as const }));
    const startB = vi.fn(async () => ({ queued: true as const }));
    const hostA = fakeHost(startA);
    const hostB = fakeHost(startB);
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    // Read-only for want of the lock: no aiStart, yet neither a send nor a refusal.
    result.current.documentOpened(hostA);
    result.current.attach(hostA, ack(false), true);
    await flush();
    expect(startA).not.toHaveBeenCalled();
    expect(status()).toBe("pending");
    result.current.detach();
    result.current.attach(hostB, ack(true), false);
    result.current.documentOpened(hostB);
    await flush();
    expect(startB).toHaveBeenCalledTimes(1);
    expect(status()).toBe("sent");
  });

  it("counts an open answered before the ack on the same endpoint", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const startAi = vi.fn(async () => ({ queued: true as const }));
    const host = fakeHost(startAi);
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    result.current.documentOpened(host);
    await flush();
    expect(startAi).not.toHaveBeenCalled();
    result.current.attach(host, ack(true), false);
    await flush();
    expect(startAi).toHaveBeenCalledTimes(1);
  });

  it("ignores a late open of an older endpoint and sends on the current one", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const startA = vi.fn(async () => ({ queued: true as const }));
    const startB = vi.fn(async () => ({ queued: true as const }));
    const hostA = fakeHost(startA);
    const hostB = fakeHost(startB);
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    result.current.attach(hostA, ack(true), false);
    result.current.detach();
    result.current.attach(hostB, ack(true), false);
    result.current.documentOpened(hostA);
    await flush();
    expect(startA).not.toHaveBeenCalled();
    expect(startB).not.toHaveBeenCalled();
    result.current.documentOpened(hostB);
    await flush();
    expect(startA).not.toHaveBeenCalled();
    expect(startB).toHaveBeenCalledTimes(1);
  });
});
