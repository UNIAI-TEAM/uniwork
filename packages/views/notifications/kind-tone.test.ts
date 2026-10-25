import { ShieldAlert } from "lucide-react";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS } from "@uniwork/core/types";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { kindIcon } from "./kind-icon";
import { kindSignal, kindTone } from "./kind-tone";
import { inboxCategory } from "./notification-category";

describe("kindTone", () => {
  it("maps every known kind", () => {
    for (const kind of NOTIFICATION_KINDS) expect(kindTone(kind)).toBeTruthy();
  });

  it("follows the module table, not its own colours", () => {
    expect(kindTone("task_assigned")).toBe(moduleTone("tasks"));
    expect(kindTone("tasks_assigned")).toBe(kindTone("task_assigned"));
    expect(kindTone("meeting_starting")).toBe(moduleTone("meetings"));
    expect(kindTone("mentioned")).toBe(moduleTone("chat"));
    expect(kindTone("member_added")).toBe(moduleTone("people"));
    expect(kindTone("document_break_glass")).toBe(moduleTone("documents"));
  });

  it("maps document_break_glass to workspace category and ShieldAlert icon", () => {
    expect(inboxCategory("document_break_glass")).toBe("workspace");
    expect(kindIcon("document_break_glass")).toBe(ShieldAlert);
  });

  // A failure is a signal, not a tint: its mark is destructive, its module tint stays the meetings one.
  it("marks a failed transcript with the destructive signal", () => {
    expect(kindSignal("meeting_transcript_failed")).toBe("destructive");
    expect(kindTone("meeting_transcript_failed")).toBe(moduleTone("meetings"));
    expect(kindSignal("meeting_transcript_ready")).toBeNull();
  });

  it("draws the summary reminder apart from the summary the system made", () => {
    expect(kindIcon("meeting_summary_reminder")).not.toBe(kindIcon("meeting_summary_ready"));
  });

  it("maps document_changed to the documents tone, the documents glyph and the updates category (UNI-2056)", () => {
    expect(kindTone("document_changed")).toBe(moduleTone("documents"));
    expect(kindIcon("document_changed")).toBe(MODULE_ICONS.documents);
    expect(inboxCategory("document_changed")).toBe("updates");
  });

  it("gives an unknown kind the neutral grey", () => {
    expect(kindTone("something_new")).toBe("gray");
  });
});

