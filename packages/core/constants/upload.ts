export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Purpose strings of the task-side FileService registry rows
 * (server/internal/files/registry.go). Sent as the `purpose` multipart field
 * on attachment uploads; an absent field is the `task_attachment` default.
 */
export const TASK_ATTACHMENT_PURPOSE = "task_attachment";
export const TASK_DESCRIPTION_IMAGE_PURPOSE = "task_description_image";
export const TASK_COMMENT_ATTACHMENT_PURPOSE = "task_comment_attachment";

// task_description_image is image-only in the registry; a non-image dropped
// into an editor is still an ordinary attachment.
const descriptionImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export function editorAttachmentPurpose(file: File): string {
  return descriptionImageTypes.has(file.type)
    ? TASK_DESCRIPTION_IMAGE_PURPOSE
    : TASK_ATTACHMENT_PURPOSE;
}
