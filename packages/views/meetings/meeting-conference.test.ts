import { describe, expect, it } from "vitest";
import { tileGridClass } from "./meeting-conference";

describe("tileGridClass", () => {
  it("uses a single column for one participant", () => {
    expect(tileGridClass(0)).toBe("grid-cols-1");
    expect(tileGridClass(1)).toBe("grid-cols-1");
  });

  it("stacks two tiles on small screens", () => {
    expect(tileGridClass(2)).toBe("grid-cols-1 sm:grid-cols-2");
  });

  it("keeps three and four tiles in two columns", () => {
    expect(tileGridClass(3)).toBe("grid-cols-2");
    expect(tileGridClass(4)).toBe("grid-cols-2");
  });

  it("adds a third column from lg when the room is crowded", () => {
    expect(tileGridClass(5)).toBe("grid-cols-2 lg:grid-cols-3");
  });
});
