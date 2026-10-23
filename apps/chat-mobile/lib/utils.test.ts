import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges conditional classes and lets the later Tailwind utility win", () => {
    const hidden = false as boolean;
    expect(cn("p-2", hidden && "hidden", "p-4", { "text-brand": true })).toBe("p-4 text-brand");
  });
});
