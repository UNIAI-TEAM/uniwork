import { describe, expect, it } from "vitest";
import { bytesToText, copyBytes, incomingBytes, isMemoryFailure, textToBytes } from "./bytes";

const memoryError = { code: "file_insufficient_memory" };

describe("renderer byte helper", () => {
  it("normalises an ArrayBuffer and a Uint8Array and refuses anything else", () => {
    expect(Array.from(incomingBytes(new Uint8Array([1, 2]).buffer))).toEqual([1, 2]);
    const view = new Uint8Array([3, 4]);
    expect(incomingBytes(view)).toBe(view);
    expect(() => incomingBytes("AQI=")).toThrow("invalid_bytes");
    expect(() => incomingBytes(new Uint16Array(2))).toThrow("invalid_bytes");
  });

  it.each([
    new RangeError("Array buffer allocation failed"),
    new RangeError("Invalid typed array length: 5000000000"),
    new RangeError("Invalid array buffer length"),
    Object.assign(new Error("Cannot create a string longer than 0x1fffffe8 characters"), { code: "ERR_STRING_TOO_LONG" }),
  ])("maps an allocation failure (%s) to file_insufficient_memory", (failure) => {
    const original = globalThis.TextDecoder;
    globalThis.TextDecoder = class { decode(): string { throw failure; } } as unknown as typeof TextDecoder;
    try { expect(() => bytesToText(new Uint8Array(1))).toThrowError(expect.objectContaining(memoryError)); }
    finally { globalThis.TextDecoder = original; }
  });

  it("lets an unrelated error through unchanged", () => {
    const original = globalThis.TextDecoder;
    globalThis.TextDecoder = class { decode(): string { throw new TypeError("not memory"); } } as unknown as typeof TextDecoder;
    try { expect(() => bytesToText(new Uint8Array(1))).toThrow("not memory"); }
    finally { globalThis.TextDecoder = original; }
  });

  it("maps a failed copy and a failed encode too, and round-trips text", () => {
    const bytes = new Uint8Array(2);
    bytes.slice = () => { throw new RangeError("Array buffer allocation failed"); };
    expect(() => copyBytes(bytes)).toThrowError(expect.objectContaining(memoryError));
    expect(bytesToText(textToBytes("xin chào"))).toBe("xin chào");
  });

  it("recognises the typed code and a raw allocation failure", () => {
    expect(isMemoryFailure(Object.assign(new Error("x"), memoryError))).toBe(true);
    expect(isMemoryFailure(new RangeError("Array buffer allocation failed"))).toBe(true);
    expect(isMemoryFailure(new Error("other"))).toBe(false);
    expect(isMemoryFailure(null)).toBe(false);
  });
});
