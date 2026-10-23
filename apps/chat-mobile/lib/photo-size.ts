// A photo picked to send is scaled down on the phone first (audit
// image-pipeline): a 12 MP original is 3–5 MB over a cellular uplink, and the
// chat shows it at most screen-sized (the bubble reads the server's 640 px
// thumbnail, the viewer the original). The longer side goes to 2048 px — over
// WhatsApp's ~1600, so a photographed page stays readable when zoomed — and the
// format stays the photo's own; anything else (an animated GIF would lose its
// frames) goes as picked.

export const PHOTO_MAX_SIDE = 2048;
/** JPEG quality of the scaled copy. */
export const PHOTO_COMPRESS = 0.8;

/** The resize that brings the longer side to PHOTO_MAX_SIDE; null when it is within it already, or the size is unknown. */
export function photoResize(width: number | undefined, height: number | undefined): { width: number } | { height: number } | null {
  if (!width || !height || Math.max(width, height) <= PHOTO_MAX_SIDE) return null;
  return width >= height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE };
}

/** The format a scaled copy is saved in: the photo's own JPEG or PNG; null for anything not re-encoded. */
export function photoSaveFormat(mimeType: string | undefined): "jpeg" | "png" | null {
  const type = mimeType?.toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return "jpeg";
  return type === "image/png" ? "png" : null;
}
