import { describe, expect, it } from "vitest";
import { systemUiOpen, whileSystemUiOpen } from "./system-ui";

describe("whileSystemUiOpen", () => {
  it("marks a system screen open until its answer comes back, nested or failed", async () => {
    expect(systemUiOpen()).toBe(false);
    let answer: (value: string) => void = () => undefined;
    const picker = whileSystemUiOpen(() => new Promise<string>((resolve) => (answer = resolve)));
    expect(systemUiOpen()).toBe(true);
    await expect(whileSystemUiOpen(async () => Promise.reject(new Error("denied")))).rejects.toThrow("denied");
    expect(systemUiOpen()).toBe(true);
    answer("photo.jpg");
    await expect(picker).resolves.toBe("photo.jpg");
    expect(systemUiOpen()).toBe(false);
  });
});
