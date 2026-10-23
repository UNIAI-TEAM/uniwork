import { expect, it, vi } from "vitest";

const register = vi.hoisted(() => vi.fn());
vi.mock("./drain-tasks", () => ({ registerOutboxDrainTasks: register }));

it("registers the outbox's drain task as soon as the entry loads it", async () => {
  await import("./background-tasks");
  expect(register).toHaveBeenCalledTimes(1);
});
