import { ShieldAlert } from "lucide-react";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS } from "@uniwork/core/types";
import { moduleTone } from "../layout/module-tones";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { inboxCategory } from "./notification-category";

describe("kindTone", () => {
  it("maps every known kind", () => {
    for (const kind of NOTIFICATION_KINDS) expect(kindTone(kind)).toBeTruthy();
  });

  it("follows the module table, not its own colours", () => {
    expect(kindTone("task_assigned")).toBe(moduleTone("tasks"));
    expect(kindTone("meeting_starting")).toBe(moduleTone("meetings"));
    expect(kindTone("mentioned")).toBe(moduleTone("chat"));
    expect(kindTone("member_added")).toBe(moduleTone("people"));
    expect(kindTone("document_break_glass")).toBe(moduleTone("documents"));
  });

  it("maps document_break_glass to workspace category and ShieldAlert icon", () => {
    expect(inboxCategory("document_break_glass")).toBe("workspace");
    expect(kindIcon("document_break_glass")).toBe(ShieldAlert);
  });

  it("gives an unknown kind the neutral grey", () => {
    expect(kindTone("something_new")).toBe("gray");
  });
});

