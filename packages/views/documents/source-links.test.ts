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
  const file = (over: Partial<Pick<DocumentSourceFile, "mime_type" | "extension" | "name" | "can_open_in_app">> = {}) =>
    ({ name: "f", mime_type: "", extension: "", can_open_in_app: false, ...over }) as DocumentSourceFile;

  it("previews an image by its mime type or extension", () => {
    expect(sourceOpenAction(file({ mime_type: "image/png" }))).toBe("image");
    expect(sourceOpenAction(file({ mime_type: "image/jpeg" }))).toBe("image");
    expect(sourceOpenAction(file({ extension: "webp" }))).toBe("image");
    expect(sourceOpenAction(file({ name: "ảnh.PNG" }))).toBe("image");
  });

  it("opens an Office format in the view-only frame when the server vouches for it (can_open_in_app)", () => {
    // UNI-1869: a module frame opens the source; the flag alone is not enough —
    // a module must exist for the extension (officeModuleForFormat), so a
    // can_open_in_app the client cannot map still downloads.
    for (const f of [
      file({ extension: "docx", can_open_in_app: true }),
      file({ extension: "xlsx", can_open_in_app: true }),
      file({ extension: "pptx", can_open_in_app: true }),
      file({ extension: "pdf", can_open_in_app: true }),
      file({ extension: "md", can_open_in_app: true }),
      file({ extension: "html", can_open_in_app: true }),
      // UNI-1813: the server marks .txt openable only while office_txt_open is on.
      file({ extension: "txt", can_open_in_app: true }),
      file({ name: "ghi-chu.txt", extension: "", mime_type: "text/plain", can_open_in_app: true }),
      file({ name: "README.TXT", extension: "", mime_type: "application/octet-stream", can_open_in_app: true }),
      file({ name: "Báo cáo.DOCX", extension: "", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", can_open_in_app: true }),
    ]) {
      expect(sourceOpenAction(f)).toBe("office");
    }
    // An image the server also marks openable keeps the SRC-02a preview.
    expect(sourceOpenAction(file({ mime_type: "image/png", can_open_in_app: true }))).toBe("image");
  });

  it("downloads a format no module opens, or when the server does not mark it openable", () => {
    for (const f of [
      file({ mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      file({ extension: "docx" }),
      file({ extension: "xlsx" }),
      file({ mime_type: "application/pdf" }),
      file({ extension: "md" }),
      file({ extension: "html" }),
      file({ extension: "zip", can_open_in_app: true }),
      // A .txt source the server did not mark (flag off) still downloads, and a
      // bare text/plain file that is not .txt never opens even when marked.
      file({ extension: "txt" }),
      file({ name: "ghi-chu.txt", mime_type: "text/plain" }),
      file({ extension: "csv", can_open_in_app: true }),
      file({ name: "app.log", mime_type: "text/plain", can_open_in_app: true }),
      file({ extension: "doc", can_open_in_app: true }),
      file({ can_open_in_app: true }),
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
