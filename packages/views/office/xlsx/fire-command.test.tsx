import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireCommand } from "./fire-command";
import { XlsxFrameNotices } from "./xlsx-frame-notices";
import type { XlsxToolbarCommands } from "./toolbar/types";

function refusing(result: boolean | Error): XlsxToolbarCommands {
  return {
    execute: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
  } as unknown as XlsxToolbarCommands;
}

const notices = (
  <XlsxFrameNotices recalcProgress={null} recalcError={null} editFailed={false} onCancelRecalculate={() => undefined} />
);

describe("refused structural commands", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a visible notice when an insert command is refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(notices);
    expect(screen.queryByTestId("xlsx-command-refused")).toBeNull();
    await act(async () => {
      fireCommand(refusing(false), "sheet.command.insert-multi-rows-after", { value: 2 });
    });
    expect(screen.getByTestId("xlsx-command-refused").textContent).toMatch(/\S/);
  });

  it("shows the notice when the structural command rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(notices);
    await act(async () => {
      fireCommand(refusing(new Error("boom")), "sheet.command.remove-col");
    });
    expect(screen.getByTestId("xlsx-command-refused")).toBeTruthy();
  });

  it("stays silent for a command that succeeds and for a non-structural refusal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(notices);
    await act(async () => {
      fireCommand(refusing(true), "sheet.command.insert-row-before", { value: 1 });
      fireCommand(refusing(false), "sheet.command.set-bold");
    });
    expect(screen.queryByTestId("xlsx-command-refused")).toBeNull();
  });
});
