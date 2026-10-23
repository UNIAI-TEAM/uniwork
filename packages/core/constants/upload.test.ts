import { describe, expect, it } from "vitest";
import {
  editorAttachmentPurpose,
  TASK_ATTACHMENT_PURPOSE,
  TASK_COMMENT_ATTACHMENT_PURPOSE,
  TASK_DESCRIPTION_IMAGE_PURPOSE,
} from "./upload";

describe("editorAttachmentPurpose", () => {
  it("maps allowlisted image MIME types to task_description_image", () => {
    for (const type of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
      const file = new File(["x"], "pic", { type });
      expect(editorAttachmentPurpose(file)).toBe(TASK_DESCRIPTION_IMAGE_PURPOSE);
    }
  });

  it("falls back to task_attachment for non-image types", () => {
    for (const type of ["text/markdown", "application/pdf", "image/svg+xml", ""]) {
      const file = new File(["x"], "doc", { type });
      expect(editorAttachmentPurpose(file)).toBe(TASK_ATTACHMENT_PURPOSE);
    }
  });
});

describe("purpose constants", () => {
  it("match the server registry strings byte-for-byte", () => {
    expect(TASK_ATTACHMENT_PURPOSE).toBe("task_attachment");
    expect(TASK_DESCRIPTION_IMAGE_PURPOSE).toBe("task_description_image");
    expect(TASK_COMMENT_ATTACHMENT_PURPOSE).toBe("task_comment_attachment");
  });
});
