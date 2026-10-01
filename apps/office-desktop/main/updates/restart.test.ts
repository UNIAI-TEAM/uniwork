import { describe, expect, it, vi } from "vitest";
import { restartToUpdate, RestartUpdateError } from "./restart";

describe("restart-to-update checkpoint", () => {
  it("flushes and confirms drafts before restarting", async () => {
    const order: string[] = [];
    await restartToUpdate({ drafts: { flushScheduled: async () => { order.push("checkpoint"); } }, confirmDrafts: async () => { order.push("confirm"); return true; }, restart: async () => { order.push("restart"); } });
    expect(order).toEqual(["checkpoint", "confirm", "restart"]);
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
});
