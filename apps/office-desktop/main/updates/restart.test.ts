import { describe, expect, it, vi } from "vitest";
import { restartToUpdate, RestartUpdateError } from "./restart";

describe("restart-to-update checkpoint", () => {
  it("asks the leave decision, then flushes drafts, then restarts", async () => {
    const order: string[] = [];
    await restartToUpdate({ drafts: { flushScheduled: async () => { order.push("checkpoint"); } }, confirmDrafts: async () => { order.push("confirm"); return true; }, restart: async () => { order.push("restart"); } });
    expect(order).toEqual(["confirm", "checkpoint", "restart"]);
  });
  it("aborts on checkpoint IO failure", async () => {
    const restart = vi.fn();
    await expect(restartToUpdate({ drafts: { flushScheduled: async () => { throw new Error("disk full"); } }, confirmDrafts: async () => true, restart })).rejects.toMatchObject({ code: "checkpoint_failed" } satisfies Partial<RestartUpdateError>);
    expect(restart).not.toHaveBeenCalled();
  });
  it("requires explicit draft confirmation", async () => {
    const restart = vi.fn();
    await expect(restartToUpdate({ drafts: { flushScheduled: async () => undefined }, confirmDrafts: async () => false, restart })).rejects.toMatchObject({ code: "confirmation_required" } satisfies Partial<RestartUpdateError>);
    expect(restart).not.toHaveBeenCalled();
  });
  it("reopens draft writes when the leave decision itself fails", async () => {
    const cancelRestart = vi.fn();
    const restart = vi.fn();
    await expect(restartToUpdate({ drafts: { flushScheduled: async () => undefined, cancelRestart }, confirmDrafts: async () => { throw new Error("dialog failed"); }, restart })).rejects.toThrow("dialog failed");
    expect(cancelRestart).toHaveBeenCalledOnce();
    expect(restart).not.toHaveBeenCalled();
  });
});
