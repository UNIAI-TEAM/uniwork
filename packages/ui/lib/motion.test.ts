import { describe, expect, it } from "vitest";
import {
  UI_FLOATING_TRANSITION_CLASS,
  UI_MODAL_TRANSITION_CLASS,
  UI_OVERLAY_TRANSITION_CLASS,
} from "./motion";

describe("shared motion classes", () => {
  it("transitions the Tailwind v4 transform longhands that actually change", () => {
    expect(UI_MODAL_TRANSITION_CLASS).toContain(
      "transition-[opacity,scale]",
    );
    expect(UI_FLOATING_TRANSITION_CLASS).toContain(
      "transition-[opacity,scale,translate]",
    );
    expect(UI_MODAL_TRANSITION_CLASS).not.toContain(
      "transition-[opacity,transform]",
    );
    expect(UI_FLOATING_TRANSITION_CLASS).not.toContain(
      "transition-[opacity,transform]",
    );
  });

  it("uses shared timing tokens and removes spatial motion when requested", () => {
    expect(UI_OVERLAY_TRANSITION_CLASS).toContain(
      "duration-(--duration-fast) ease-out-quart",
    );
    expect(UI_MODAL_TRANSITION_CLASS).toContain(
      "duration-(--duration-standard) ease-out-quart",
    );
    expect(UI_FLOATING_TRANSITION_CLASS).toContain(
      "motion-reduce:data-starting-style:!translate-none",
    );
    expect(UI_FLOATING_TRANSITION_CLASS).toContain(
      "motion-reduce:data-ending-style:!translate-none",
    );
    expect(UI_FLOATING_TRANSITION_CLASS).toContain(
      "motion-reduce:data-starting-style:scale-100",
    );
    expect(UI_FLOATING_TRANSITION_CLASS).toContain(
      "motion-reduce:data-ending-style:scale-100",
    );
  });
});
