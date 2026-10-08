import { describe, expect, it } from "vitest";
import { isAllocationFailure, isMemoryFailure } from "./memory";

describe("isAllocationFailure", () => {
  it.each([
    new RangeError("Array buffer allocation failed"),
    new RangeError("Invalid typed array length: 5000000000"),
    new RangeError("Invalid string length"),
    new RangeError("Invalid array buffer length"),
    Object.assign(new RangeError("File size is greater than 2 GiB"), { code: "ERR_FS_FILE_TOO_LARGE" }),
    Object.assign(new Error("Cannot create a string longer than 0x1fffffe8 characters"), { code: "ERR_STRING_TOO_LONG" }),
    Object.assign(new Error("spawn ENOMEM"), { code: "ENOMEM" }),
  ])("recognises %s", (error) => expect(isAllocationFailure(error)).toBe(true));

  it.each([new Error("ENOENT"), Object.assign(new Error("gone"), { code: "ENOENT" }), new RangeError("Maximum call stack size exceeded"), null, "x"])("ignores %s", (error) => expect(isAllocationFailure(error)).toBe(false));
});

const invoke = (thrown: string) => new Error(`Error invoking remote method 'desktop:office-open': ${thrown}`);

describe("isMemoryFailure", () => {
  it.each([
    new RangeError("Array buffer allocation failed"),
    Object.assign(new Error("x"), { code: "file_insufficient_memory" }),
    invoke("EngineHostExitError: insufficient_memory"),
    invoke("FileIpcError: insufficient_memory"),
    invoke("Error: file_insufficient_memory"),
    invoke("RangeError: Array buffer allocation failed"),
    invoke("RangeError: Invalid string length"),
    invoke("RangeError [ERR_FS_FILE_TOO_LARGE]: File size (3000000000) is greater than 2 GiB"),
    invoke("Error [ERR_STRING_TOO_LONG]: Cannot create a string longer than 0x1fffffe8 characters"),
    invoke("Error: ENOMEM"),
  ])("recognises %s", (error) => expect(isMemoryFailure(error)).toBe(true));

  it.each([
    new Error("boom"),
    new Error("insufficient_memory"),
    invoke("Error: boom"),
    invoke("Error: insufficient_memory is not a word here"),
    invoke("Error: Array buffer allocation failed"),
    invoke("RangeError: Maximum call stack size exceeded"),
    invoke("Error [ERR_INVALID_ARG_TYPE]: bad argument"),
    new Error("Error invoking remote method 'x' RangeError: Array buffer allocation failed"),
    null,
    "Error invoking remote method 'x': RangeError: Array buffer allocation failed",
  ])("keeps %s generic", (error) => expect(isMemoryFailure(error)).toBe(false));
});
