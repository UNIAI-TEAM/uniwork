import { describe, expect, it } from "vitest";
import { applyChatScrollAwayHysteresis } from "./use-chat-timeline-scroll";

describe("applyChatScrollAwayHysteresis", () => {
  it("enters away only after leaving the bottom band", () => {
    const stick = { current: true };
    const away = { current: false };
    const el = { scrollTop: 500, scrollHeight: 3000, clientHeight: 500 } as HTMLDivElement;
    expect(applyChatScrollAwayHysteresis(el, stick, away)).toBe("entered-away");
    expect(away.current).toBe(true);
    expect(stick.current).toBe(false);
  });

  it("returns to bottom only inside the leave band", () => {
    const stick = { current: false };
    const away = { current: true };
    const el = { scrollTop: 4200, scrollHeight: 5000, clientHeight: 500 } as HTMLDivElement;
    expect(applyChatScrollAwayHysteresis(el, stick, away)).toBe("none");
    el.scrollTop = 4440;
    expect(applyChatScrollAwayHysteresis(el, stick, away)).toBe("returned-bottom");
  });
});
