import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxGridHandle } from "../xlsx-grid-surface";
import { useXlsxGridFormat } from "./use-xlsx-grid-format";

function port(ran: number) {
  const executeCommandsAsOneStep = vi.fn((_steps: readonly unknown[], _options?: { rollback?: boolean }) => Promise.resolve(ran));
  const grid = { executeCommandsAsOneStep, getActiveFormatState: () => null } as unknown as XlsxGridHandle;
  const { result } = renderHook(() => useXlsxGridFormat({ current: grid }));
  return { commands: result.current.commands, executeCommandsAsOneStep };
}

describe("useXlsxGridFormat executeAsOneStep", () => {
  const steps = [{ id: "a" }, { id: "b" }];

  it("asks the grid to roll a refused batch back only for an atomic run (review dvcf F1)", async () => {
    const { commands, executeCommandsAsOneStep } = port(2);
    await expect(commands.executeAsOneStep!(steps, { atomic: true })).resolves.toBe(true);
    expect(executeCommandsAsOneStep).toHaveBeenLastCalledWith(steps, { rollback: true });
    await commands.executeAsOneStep!(steps);
    expect(executeCommandsAsOneStep).toHaveBeenLastCalledWith(steps, undefined);
  });

  it("counts only a fully completed batch as run", async () => {
    await expect(port(1).commands.executeAsOneStep!(steps, { atomic: true })).resolves.toBe(false);
    await expect(port(0).commands.executeAsOneStep!(steps)).resolves.toBe(false);
  });
});
