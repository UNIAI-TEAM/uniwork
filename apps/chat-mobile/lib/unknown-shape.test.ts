import { describe, expect, it } from "vitest";
import { asRecord, isRecord, pathOf } from "./unknown-shape";

describe("unknown-shape", () => {
  it("reads only a plain object as a record", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], "x", 3, true]) expect(isRecord(value)).toBe(false);
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toBeNull();
  });

  it("follows a path while each step is a record", () => {
    const err = { status: 409, body: { error: { code: "owner_must_transfer" } } };
    expect(pathOf(err, "body", "error", "code")).toBe("owner_must_transfer");
    expect(pathOf(err, "status")).toBe(409);
    expect(pathOf(err, "status", "x")).toBeUndefined();
    expect(pathOf(null, "body")).toBeUndefined();
    expect(pathOf("x")).toBe("x");
  });
});
