import { describe, expect, it } from "vitest";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { paths } from "@uniwork/core/paths";
import { sourceLinkLabelKey, sourceParentPath } from "./source-links";

const ws = paths.workspace("acme", "eng");

describe("sourceParentPath", () => {
  it("leads a task and a task comment attachment to the task", () => {
    expect(sourceParentPath(ws, { kind: "task", id: "t1", title: "" })).toBe(ws.task("t1"));
    expect(sourceParentPath(ws, { kind: "task_comment", id: "t1", title: "" })).toBe(ws.task("t1"));
  });

  it("opens the module for chat and email, the meeting by id, and nothing for an unknown kind", () => {
    expect(sourceParentPath(ws, { kind: "chat_dm", id: "c", title: "" })).toBe(ws.chat());
    expect(sourceParentPath(ws, { kind: "email_thread", id: "e", title: "" })).toBe(ws.email());
    expect(sourceParentPath(ws, { kind: "meeting", id: "m1", title: "" })).toBe(ws.meeting("m1"));
    expect(sourceLinkLabelKey({ kind: "chat_channel", id: "c", title: "" })).toBe("documents.home.row.open_chat");
    expect(sourceLinkLabelKey({ kind: "email_thread", id: "e", title: "" })).toBe("documents.home.row.open_email");
    expect(sourceLinkLabelKey({ kind: "task_comment", id: "t", title: "" })).toBe("documents.home.row.go_to_source");
    expect(sourceParentPath(ws, { kind: "fax", id: "x", title: "" } as unknown as DocumentSourceFile["parent"])).toBeNull();
  });
});
