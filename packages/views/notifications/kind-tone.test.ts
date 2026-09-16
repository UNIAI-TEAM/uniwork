import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS } from "@uniwork/core/types";
import { moduleTone } from "../layout/module-tones";
import { kindTone } from "./kind-tone";

describe("kindTone", () => {
  it("maps every known kind", () => {
    for (const kind of NOTIFICATION_KINDS) expect(kindTone(kind)).toBeTruthy();
  });

  it("follows the module table, not its own colours", () => {
    expect(kindTone("task_assigned")).toBe(moduleTone("tasks"));
    expect(kindTone("meeting_starting")).toBe(moduleTone("meetings"));
    expect(kindTone("mentioned")).toBe(moduleTone("chat"));
    expect(kindTone("member_added")).toBe(moduleTone("people"));
  });

  it("gives an unknown kind the neutral grey", () => {
    expect(kindTone("something_new")).toBe("gray");
  });
});
