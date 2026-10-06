import { describe, expect, it } from "vitest";
import { PRESENTER_RACE_MS, presenterVerdict } from "./single-presenter";

describe("presenterVerdict", () => {
  it("gives way to a share that started clearly after ours", () => {
    expect(presenterVerdict({ identity: "zed", since: 0 }, { identity: "amy", since: PRESENTER_RACE_MS + 1 })).toBe(
      "yield",
    );
  });

  it("keeps presenting over a share that was on well before ours: ours took over", () => {
    expect(presenterVerdict({ identity: "amy", since: 10_000 }, { identity: "zed", since: 0 })).toBe("stay");
    expect(presenterVerdict({ identity: "amy", since: 10_000 }, { identity: "zed", since: -Infinity })).toBe("stay");
  });

  it("settles two shares started together by identity, so exactly one side stops", () => {
    const amy = { identity: "amy", since: 1_000 };
    const zed = { identity: "zed", since: 2_500 };
    // Each client measures the other against its own start; both read a race.
    expect(presenterVerdict(amy, zed)).toBe("yield-if-still-on");
    expect(presenterVerdict(zed, { ...amy, since: zed.since - 200 })).toBe("stay");
  });

  it("never has both sides stop near the race edge", () => {
    // amy starts at 0, zed 2.9 s later, 200 ms one way. amy reads a takeover
    // and stops at once; zed reads a race it loses on identity, so it only
    // stops if amy's share is still on after the grace.
    expect(presenterVerdict({ identity: "zed", since: 0 }, { identity: "amy", since: 3_100 })).toBe("yield");
    expect(presenterVerdict({ identity: "amy", since: 2_900 }, { identity: "zed", since: 200 })).toBe(
      "yield-if-still-on",
    );
  });
});
