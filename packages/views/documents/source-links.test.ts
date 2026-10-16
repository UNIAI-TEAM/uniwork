import { describe, expect, it } from "vitest";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { paths } from "@uniwork/core/paths";
import { sourceLinkLabelKey, sourceLinkNamedLabelKey, sourceOpenAction, sourceParentLinked, sourceParentPath } from "./source-links";

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
    expect(sourceParentPath(ws, { kind: "chat_channel", id: "room2", title: "", message_id: "msg9" })).toBe(
      ws.chatConversation("room2", "msg9"),
    );
  });

  it("opens the DM room at the message the file was sent in", () => {
    expect(sourceParentPath(ws, parent("chat_dm", "dm1", "msg2"))).toBe("/acme/eng/chat?room=dm1&message=msg2");
  });

  it("opens a group room the same way (the server sends it as chat_dm with the group's room id)", () => {
    expect(sourceParentPath(ws, parent("chat_dm", "group1", "msg3"))).toBe(ws.chatConversation("group1", "msg3"));
  });

  it("opens the room alone when the server named no message", () => {
    expect(sourceParentPath(ws, parent("chat_channel", "room1"))).toBe("/acme/eng/chat?room=room1");
    expect(sourceParentPath(ws, { kind: "chat_dm", id: "room1", title: "" })).toBe(ws.chatConversation("room1"));
  });

  it("opens the Email Hub for an email thread, which has no thread route", () => {
    expect(sourceParentPath(ws, parent("email_thread", "e"))).toBe(ws.email());
  });

  it("opens the meeting by id, and nothing for an unknown kind", () => {
    expect(sourceParentPath(ws, parent("meeting", "m1"))).toBe(ws.meeting("m1"));
    expect(sourceParentPath(ws, { kind: "fax", id: "x", title: "", message_id: "" } as unknown as Parent)).toBeNull();
  });
});

describe("sourceParentLinked", () => {
  it("links every known parent kind and not an unknown one", () => {
    for (const kind of ["task", "task_comment", "meeting", "chat_channel", "chat_dm", "email_thread"] as const) {
      expect(sourceParentLinked(parent(kind, "x"))).toBe(true);
    }
    expect(sourceParentLinked({ kind: "fax", id: "x", title: "", message_id: "" } as unknown as Parent)).toBe(false);
  });
});

describe("sourceLinkNamedLabelKey", () => {
  it("names the row button after its visible label (WCAG 2.5.3)", () => {
    expect(sourceLinkNamedLabelKey(parent("chat_channel", "c", "m"))).toBe("documents.home.row.go_to_source_named");
    expect(sourceLinkNamedLabelKey(parent("email_thread", "e"))).toBe("documents.home.row.open_email_named");
  });
});

describe("sourceLinkLabelKey", () => {
  it("says View where attached for chat now that it reaches the room and message", () => {
    expect(sourceLinkLabelKey(parent("chat_channel", "c", "m"))).toBe("documents.home.row.go_to_source");
    expect(sourceLinkLabelKey(parent("chat_dm", "c", "m"))).toBe("documents.home.row.go_to_source");
    expect(sourceLinkLabelKey({ kind: "chat_channel", id: "c", title: "" })).toBe("documents.home.row.go_to_source");
  });

  it("keeps the email label, since email opens the hub only", () => {
    expect(sourceLinkLabelKey(parent("email_thread", "e"))).toBe("documents.home.row.open_email");
  });

  it("says View where attached for task, comment and meeting", () => {
    expect(sourceLinkLabelKey(parent("task", "t"))).toBe("documents.home.row.go_to_source");
    expect(sourceLinkLabelKey(parent("task_comment", "t"))).toBe("documents.home.row.go_to_source");
    expect(sourceLinkLabelKey(parent("meeting", "m"))).toBe("documents.home.row.go_to_source");
  });
});

describe("sourceOpenAction", () => {
  const file = (over: Partial<Pick<DocumentSourceFile, "mime_type" | "extension" | "name">> = {}) =>
    ({ name: "f", mime_type: "", extension: "", ...over }) as DocumentSourceFile;

  it("previews an image by its mime type or extension", () => {
    expect(sourceOpenAction(file({ mime_type: "image/png" }))).toBe("image");
    expect(sourceOpenAction(file({ mime_type: "image/jpeg" }))).toBe("image");
    expect(sourceOpenAction(file({ extension: "webp" }))).toBe("image");
    expect(sourceOpenAction(file({ name: "ảnh.PNG" }))).toBe("image");
  });

  it("downloads everything else until a view-only source frame route exists", () => {
    // U-SRC1 wants Office formats in the Office viewer; the office-frame API is
    // document-bound, so a source file downloads until the server gap closes.
    for (const f of [
      file({ mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      file({ extension: "docx" }),
      file({ extension: "xlsx" }),
      file({ mime_type: "application/pdf" }),
      file({ extension: "md" }),
      file({ extension: "html" }),
      file({ extension: "zip" }),
      file(),
    ]) {
      expect(sourceOpenAction(f)).toBe("download");
    }
  });

  it("previews only the mime types a browser can draw; tiff/heic/svg download", () => {
    for (const f of [
      file({ mime_type: "image/tiff" }),
      file({ mime_type: "image/heic" }),
      file({ mime_type: "image/x-icon" }),
      file({ mime_type: "image/svg+xml" }),
      file({ extension: "svg" }),
      file({ mime_type: "IMAGE/PNG" }),
    ]) {
      // The image/ prefix is not enough: only the IMAGE_EXTENSIONS set previews.
      expect(sourceOpenAction(f)).toBe(f.mime_type === "IMAGE/PNG" ? "image" : "download");
    }
  });
});
