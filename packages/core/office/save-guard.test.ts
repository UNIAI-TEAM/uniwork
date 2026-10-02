import { expect, it } from "vitest";
import { createOfficeSaveGuard } from "./save-guard";

it("allows one operation and rejects a concurrent N+1 without queueing", () => {
  const guard = createOfficeSaveGuard();
  const events: boolean[] = [];
  guard.subscribe((busy) => events.push(busy));
  const release = guard.tryAcquire();
  expect(release).toBeTypeOf("function");
  expect(guard.busy).toBe(true);
  expect(guard.tryAcquire()).toBeUndefined();
  release?.();
  release?.();
  expect(guard.busy).toBe(false);
  expect(events).toEqual([true, false]);
});
