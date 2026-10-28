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
    result.current.attach(fakeHost(startAi), ack(true));
    expect(startAi).not.toHaveBeenCalled();
    result.current.documentOpened(result.current.generation());
    await flush();
    expect(startAi).toHaveBeenCalledTimes(1);
    expect(startAi).toHaveBeenCalledWith({ handoffId: "h1", text: "Soạn báo cáo", displayText: "Soạn báo cáo" });
    expect(status()).toBe("sent");
    // A remount (a new handshake with a new host) finds the entry consumed.
    result.current.detach();
    result.current.attach(fakeHost(startAi), ack(true));
    result.current.documentOpened(result.current.generation());
    await flush();
    expect(startAi).toHaveBeenCalledTimes(1);
  });

  it("refuses without sending when the frame did not claim aiStart", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const startAi = vi.fn(async () => ({ queued: true as const }));
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    result.current.attach(fakeHost(startAi), ack(false));
    result.current.documentOpened(result.current.generation());
    await flush();
    expect(startAi).not.toHaveBeenCalled();
    expect(status()).toBe("refused");
  });

  it("marks the job refused when the frame rejects it", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    result.current.attach(fakeHost(vi.fn(async () => { throw new Error("unsupported"); })), ack(true));
    result.current.documentOpened(result.current.generation());
    await flush();
    expect(status()).toBe("refused");
  });

  it("does nothing for a document with no entry", async () => {
    const startAi = vi.fn(async () => ({ queued: true as const }));
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    result.current.attach(fakeHost(startAi), ack(true));
    result.current.documentOpened(result.current.generation());
    await flush();
    expect(startAi).not.toHaveBeenCalled();
    expect(useOfficeHandoffStore.getState().byDocument).toEqual({});
  });

  it("follows the frame's AI runs only for a document with an entry", async () => {
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    result.current.onAiRun("running");
    expect(useOfficeHandoffStore.getState().byDocument).toEqual({});
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    result.current.onAiRun("running");
    expect(status()).toBe("running");
    result.current.onAiRun("idle");
    expect(status()).toBe("idle");
  });

  it("ignores a late open of an older handshake and sends on the current one", async () => {
    useOfficeHandoffStore.getState().queue(DOC, "h1", "x");
    const startA = vi.fn(async () => ({ queued: true as const }));
    const startB = vi.fn(async () => ({ queued: true as const }));
    const { result } = renderHook(() => useFrameAiHandoff(DOC));
    result.current.attach(fakeHost(startA), ack(true));
    const genA = result.current.generation();
    result.current.detach();
    result.current.attach(fakeHost(startB), ack(true));
    result.current.documentOpened(genA);
    await flush();
    expect(startA).not.toHaveBeenCalled();
    expect(startB).not.toHaveBeenCalled();
    result.current.documentOpened(result.current.generation());
    await flush();
    expect(startA).not.toHaveBeenCalled();
    expect(startB).toHaveBeenCalledTimes(1);
  });
});
