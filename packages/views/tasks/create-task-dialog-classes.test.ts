import { describe, expect, it } from "vitest";
import {
  agentDialogContentClass,
  manualDialogContentClass,
} from "./create-task-dialog-classes";

describe("create task dialog motion classes", () => {
  it.each([
    ["manual", manualDialogContentClass],
    ["agent", agentDialogContentClass],
  ])("keeps %s open/close and resize motion on Tailwind v4 longhands", (_, classes) => {
    const value = classes(false);

    expect(value).toContain(
      "!transition-[opacity,width,height,max-width,scale,translate]",
    );
    expect(value).toContain("!ease-out-quart");
    expect(value).toContain("motion-reduce:!transition-opacity");
    expect(value).not.toContain("transition-[width,height,max-width,transform]");
  });

  it("gives the manual composer most of a phone's height, where a fixed 24rem leaves the body a few lines", () => {
    expect(manualDialogContentClass(false)).toContain("max-sm:!h-[85dvh]");
  });
});
