import { describe, expect, it } from "vitest";
import { isAllocationFailure } from "./memory";

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
