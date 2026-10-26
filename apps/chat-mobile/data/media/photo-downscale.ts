// Scales a picked photo down before it is queued (lib/photo-size.ts says when
// and to what): the copy the outbox keeps (data/outbox-files.ts) and uploads is
// the scaled one. The re-encode also drops the original's metadata (EXIF, GPS
// position included), which the chat never shows. Best effort: a photo that
// cannot be read or written goes as picked, still within the server's limit
// checks.
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { PHOTO_COMPRESS, photoResize, photoSaveFormat } from "@/lib/photo-size";
import type { PendingFile } from "@/lib/send-pipeline";
import { createLogger } from "../logger";

const log = createLogger("photo-downscale");

/** `file` scaled so its longer side is at most PHOTO_MAX_SIDE; `file` itself when it is within it, or not a photo we re-encode. */
export async function downscalePhoto(file: PendingFile, size: { width?: number; height?: number }): Promise<PendingFile> {
  const resize = photoResize(size.width, size.height);
  const format = photoSaveFormat(file.mimeType);
  if (!resize || !format) return file;
  try {
    const image = await ImageManipulator.manipulate(file.uri).resize(resize).renderAsync();
    const saved = await image.saveAsync({ compress: PHOTO_COMPRESS, format: format === "png" ? SaveFormat.PNG : SaveFormat.JPEG });
    return { ...file, uri: saved.uri, size: new File(saved.uri).size };
  } catch (error) {
    log.warn("photo not scaled, sending as picked", { error: error instanceof Error ? error.name : typeof error });
    return file;
  }
}
