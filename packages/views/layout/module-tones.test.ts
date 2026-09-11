import { describe, expect, it } from "vitest";
import { TINTS } from "@uniwork/ui/components/common/icon-tile";
import { MODULE_TONES, moduleTone } from "./module-tones";

describe("module tones", () => {
  it("assigns every module a declared tint", () => {
    for (const tone of Object.values(MODULE_TONES)) expect(TINTS).toContain(tone);
  });

  it("keeps the two task surfaces on one colour", () => {
    // "Công việc" and "Việc của tôi" are the same module seen twice; a
    // different tint would read as a different product.
    expect(moduleTone("tasks")).toBe(moduleTone("my_tasks"));
  });
});
