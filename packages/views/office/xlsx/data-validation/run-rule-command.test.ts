import { describe, expect, it, vi } from "vitest";
import { runRuleCommand, runRuleCommandsAtomically } from "./run-rule-command";

describe("runRuleCommand", () => {
  it("calls execute once and reports acceptance", async () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    await expect(runRuleCommand({ execute }, "c", { a: 1 })).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("c", { a: 1 });
    await expect(runRuleCommand({ execute: async () => true }, "c", {})).resolves.toBe(true);
  });

  it("reports false for a refusal, a rejection and a synchronous throw", async () => {
    await expect(runRuleCommand({ execute: () => false }, "c", {})).resolves.toBe(false);
    await expect(runRuleCommand({ execute: () => Promise.resolve(false) }, "c", {})).resolves.toBe(false);
    await expect(runRuleCommand({ execute: () => Promise.reject(new Error("x")) }, "c", {})).resolves.toBe(false);
    await expect(
      runRuleCommand({ execute: () => { throw new Error("boom"); } }, "c", {}),
    ).resolves.toBe(false);
  });

  it("treats the pinned async-handler TypeError as accepted", async () => {
    const execute = () => { throw new TypeError("[CommandService]: Command handler should not return a promise."); };
    await expect(runRuleCommand({ execute }, "c", {})).resolves.toBe(true);
    const other = () => { throw new TypeError("something else"); };
    await expect(runRuleCommand({ execute: other }, "c", {})).resolves.toBe(false);
  });
});

describe("runRuleCommandsAtomically", () => {
  const steps = [{ id: "a", params: 1 }, { id: "b", params: 2 }];
  it("accepts no steps, runs one alone and several as one atomic step", async () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    const executeAsOneStep = vi.fn((_steps: readonly unknown[], _options?: { atomic?: boolean }) => Promise.resolve(true));
    await expect(runRuleCommandsAtomically({ execute, executeAsOneStep }, [])).resolves.toBe(true);
    await expect(runRuleCommandsAtomically({ execute, executeAsOneStep }, [steps[0]!])).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith("a", 1);
    await expect(runRuleCommandsAtomically({ execute, executeAsOneStep }, steps)).resolves.toBe(true);
    expect(executeAsOneStep).toHaveBeenCalledWith(steps, { atomic: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses several steps without the batch port, and a rejected batch", async () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    await expect(runRuleCommandsAtomically({ execute }, steps)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
    await expect(runRuleCommandsAtomically({ execute, executeAsOneStep: () => Promise.reject(new Error("x")) }, steps)).resolves.toBe(false);
  });
});
