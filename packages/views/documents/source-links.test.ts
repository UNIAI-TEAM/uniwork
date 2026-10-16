import { describe, expect, it } from "vitest";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { paths } from "@uniwork/core/paths";
import { sourceLinkLabelKey, sourceParentPath } from "./source-links";

const ws = paths.workspace("acme", "eng");

type Parent = DocumentSourceFile["parent"];
const parent = (kind: Parent["kind"], id: string, message_id = ""): Parent => ({ kind, id, title: "", message_id });

describe("sourceParentPath", () => {
  it("leads a task and a task comment attachment to the task", () => {
    expect(sourceParentPath(ws, parent("task", "t1"))).toBe(ws.task("t1"));
    expect(sourceParentPath(ws, parent("task_comment", "t1"))).toBe(ws.task("t1"));
  });

  it("opens the channel room at the message the file was sent in", () => {
    expect(sourceParentPath(ws, parent("chat_channel", "room1", "msg1"))).toBe("/acme/eng/chat?room=room1&message=msg1");
  });

  it("opens the DM room at the message the file was sent in", () => {
    expect(sourceParentPath(ws, parent("chat_dm", "dm1", "msg2"))).toBe("/acme/eng/chat?room=dm1&message=msg2");
  });

  it("opens a group room the same way (the server sends it as chat_dm with the group's room id)", () => {
    expect(sourceParentPath(ws, parent("chat_dm", "group1", "msg3"))).toBe(ws.chat({ room: "group1", message: "msg3" }));
  });

  it("opens the room alone when the server named no message", () => {
    expect(sourceParentPath(ws, parent("chat_channel", "room1"))).toBe("/acme/eng/chat?room=room1");
  });

  it("opens the Email Hub for an email thread, which has no thread route", () => {
    expect(sourceParentPath(ws, parent("email_thread", "e"))).toBe(ws.email());
  });

  it("opens the meeting by id, and nothing for an unknown kind", () => {
    expect(sourceParentPath(ws, parent("meeting", "m1"))).toBe(ws.meeting("m1"));
    expect(sourceParentPath(ws, { kind: "fax", id: "x", title: "", message_id: "" } as unknown as Parent)).toBeNull();
  });
});

describe("sourceLinkLabelKey", () => {
  it("says go to the original for chat now that it reaches the message", () => {
    expect(sourceLinkLabelKey(parent("chat_channel", "c", "m"))).toBe("documents.home.row.go_to_source");
    expect(sourceLinkLabelKey(parent("chat_dm", "c", "m"))).toBe("documents.home.row.go_to_source");
  });

  it("keeps the email label, since email opens the hub only", () => {
    expect(sourceLinkLabelKey(parent("email_thread", "e"))).toBe("documents.home.row.open_email");
  });

  it("says go to the original for task, comment and meeting", () => {
    expect(sourceLinkLabelKey(parent("task", "t"))).toBe("documents.home.row.go_to_source");
    expect(sourceLinkLabelKey(parent("task_comment", "t"))).toBe("documents.home.row.go_to_source");
    expect(sourceLinkLabelKey(parent("meeting", "m"))).toBe("documents.home.row.go_to_source");
  });
});
