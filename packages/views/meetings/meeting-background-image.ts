"use client";

/** Longest edge kept for a custom background: enough for a 720p camera. */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.85;

/** The size an image is drawn at so its longest edge fits `maxEdge`; never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The uploaded file as a small JPEG data URL. The preference store persists
 * to localStorage (about five million characters per origin); a 5 MB photo
 * as base64 is ~6.7 million and the write would throw. Downscaled it is a few
 * hundred KB, and the background processor has less to decode each frame.
 */
export async function backgroundImageDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}
