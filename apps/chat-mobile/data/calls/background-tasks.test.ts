import { expect, it, vi } from "vitest";

const register = vi.hoisted(() => vi.fn());
vi.mock("./call-wiring", () => ({ registerCallBackgroundTasks: register }));

it("registers the call tasks as soon as the entry loads it", async () => {
  await import("./background-tasks");
  expect(register).toHaveBeenCalledTimes(1);
});
