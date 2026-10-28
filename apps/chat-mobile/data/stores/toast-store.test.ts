import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOASTS, NOTICE_DURATION_MS, TOAST_DURATION_MS, toast, useToastStore } from "./toast-store";

const messages = () => useToastStore.getState().toasts.map((t) => `${t.tone}:${t.message}`);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  useToastStore.getState().clear();
  vi.useRealTimers();
});

describe("toast store", () => {
  it("shows a toast per tone and dismisses it on its own after its duration", () => {
    toast.error("send failed");
    toast.info("copied");
    toast.success("saved");
    expect(messages()).toEqual(["error:send failed", "info:copied", "success:saved"]);
    vi.advanceTimersByTime(TOAST_DURATION_MS.success);
    expect(messages()).toEqual(["error:send failed", "info:copied"]);
    vi.advanceTimersByTime(TOAST_DURATION_MS.info - TOAST_DURATION_MS.success);
    expect(messages()).toEqual(["error:send failed"]);
    vi.advanceTimersByTime(TOAST_DURATION_MS.error - TOAST_DURATION_MS.info);
    expect(messages()).toEqual([]);
  });

  it("is an error by default, and a person can dismiss one early", () => {
    const id = useToastStore.getState().show("offline");
    expect(messages()).toEqual(["error:offline"]);
    useToastStore.getState().dismiss(id);
    expect(messages()).toEqual([]);
    // its timer is gone with it: nothing fires later
    vi.advanceTimersByTime(TOAST_DURATION_MS.error);
    expect(messages()).toEqual([]);
  });

  it("folds the same message into one toast and restarts its clock", () => {
    const first = toast.error("react failed");
    vi.advanceTimersByTime(TOAST_DURATION_MS.error - 100);
    expect(toast.error("react failed")).toBe(first);
    expect(messages()).toEqual(["error:react failed"]);
    vi.advanceTimersByTime(200);
    expect(messages()).toEqual(["error:react failed"]);
    vi.advanceTimersByTime(TOAST_DURATION_MS.error);
    expect(messages()).toEqual([]);
  });

  it("keeps a notice its own while, over its tone's", () => {
    toast.success("account taken back", { durationMs: NOTICE_DURATION_MS });
    vi.advanceTimersByTime(TOAST_DURATION_MS.success);
    expect(messages()).toEqual(["success:account taken back"]);
    vi.advanceTimersByTime(NOTICE_DURATION_MS - TOAST_DURATION_MS.success);
    expect(messages()).toEqual([]);
  });

  it("keeps the newest few: the oldest leaves when one more arrives", () => {
    for (let i = 0; i < MAX_TOASTS + 1; i++) toast.info(`n${i}`);
    expect(messages()).toEqual(Array.from({ length: MAX_TOASTS }, (_, i) => `info:n${i + 1}`));
  });

  it("clears everything at once, timers included", () => {
    toast.error("a");
    toast.info("b");
    useToastStore.getState().clear();
    expect(messages()).toEqual([]);
    vi.advanceTimersByTime(TOAST_DURATION_MS.error);
    expect(messages()).toEqual([]);
  });
});
