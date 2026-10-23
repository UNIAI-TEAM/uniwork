import { describe, expect, it } from "vitest";
import { settled } from "./settled";

describe("settled", () => {
  it("resolves once the promise has finished, either way", async () => {
    await expect(settled(Promise.resolve(1))).resolves.toBeUndefined();
    await expect(settled(Promise.reject(new Error("x")))).resolves.toBeUndefined();
  });
});
