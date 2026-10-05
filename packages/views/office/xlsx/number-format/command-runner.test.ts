import { describe, expect, it, vi } from "vitest";
import { runNumberFormatCommand } from "./command-runner";
import { XLSX_NUMBER_FORMAT_COMMANDS } from "./catalog";

const ASYNC_HANDLER_ERROR = "[CommandService]: Command handler should not return a promise.";

describe("runNumberFormatCommand", () => {
  it("returns false without a port and forwards id and params otherwise", () => {
    expect(runNumberFormatCommand(undefined, XLSX_NUMBER_FORMAT_COMMANDS.increaseDecimals)).toBe(false);
    const execute = vi.fn(() => true);
    const params = { values: [{ row: 0, col: 0, pattern: "0.00" }] };
    expect(runNumberFormatCommand({ execute }, XLSX_NUMBER_FORMAT_COMMANDS.set, params)).toBe(true);
    expect(execute).toHaveBeenCalledWith("sheet.command.numfmt.set.numfmt", params);
    const refuse = vi.fn(() => false);
    expect(runNumberFormatCommand({ execute: refuse }, XLSX_NUMBER_FORMAT_COMMANDS.increaseDecimals)).toBe(false);
  });

  it("absorbs the pinned async-handler TypeError the decimal commands raise", () => {
    const execute = vi.fn(() => {
      throw new TypeError(ASYNC_HANDLER_ERROR);
    });
    expect(() => runNumberFormatCommand({ execute }, XLSX_NUMBER_FORMAT_COMMANDS.increaseDecimals)).not.toThrow();
    expect(runNumberFormatCommand({ execute }, XLSX_NUMBER_FORMAT_COMMANDS.decreaseDecimals)).toBe(false);
  });

  it("rethrows every other failure", () => {
    const otherTypeError = vi.fn(() => {
      throw new TypeError("something else broke");
    });
    expect(() => runNumberFormatCommand({ execute: otherTypeError }, XLSX_NUMBER_FORMAT_COMMANDS.set)).toThrow(
      "something else broke",
    );
    const notRegistered = vi.fn(() => {
      throw new Error('[CommandService]: command "nope" is not registered.');
    });
    expect(() => runNumberFormatCommand({ execute: notRegistered }, "nope")).toThrow("is not registered");
  });
});
