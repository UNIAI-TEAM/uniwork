// How the app asks expo-image for a picture (audit H2). A chat photo's URL is
// presigned and changes every signing window (server: chatMediaSigningWindow),
// so the cache is keyed by what the picture is, not by its URL: the message
// and the variant for chat media, the URL without its query (the signature)
// for avatars and icons, whose object path already names one immutable file.
// Every image sits in memory and on disk: a list scrolled back, a room
// reopened or an avatar seen again draws from the cache.

export const IMAGE_CACHE_POLICY = "memory-disk" as const;

type ChatMediaVariant = "thumb" | "full";

export interface CachedImageSource {
  uri: string;
  cacheKey: string;
}

/** A chat photo: one cache entry per message and variant, whichever signed URL fetched it. */
export function chatMediaSource(uri: string, messageId: string, variant: ChatMediaVariant): CachedImageSource {
  return { uri, cacheKey: `chat-media:${messageId}:${variant}` };
}

/** An avatar or workspace icon: keyed by the URL without its query or fragment (the signature, never the file). */
export function stableImageSource(uri: string): CachedImageSource {
  return { uri, cacheKey: uri.replace(/[?#].*$/, "") };
}

/** The photo bubble's box (the MobileChat board: 230 pt wide), shaped like the photo when its size is known. */
const BUBBLE_WIDTH = 230;
const BUBBLE_MAX_HEIGHT = 300;
const BUBBLE_MIN_SIDE = 120;

export function bubbleImageSize(width: number | undefined, height: number | undefined): { width: number; height: number } {
  if (!width || !height || width <= 0 || height <= 0) return { width: BUBBLE_WIDTH, height: BUBBLE_WIDTH };
  const ratio = width / height;
  // Wide: full width, as tall as the photo allows. Tall: up to the cap, as wide as the photo allows.
  if (ratio >= BUBBLE_WIDTH / BUBBLE_MAX_HEIGHT) return { width: BUBBLE_WIDTH, height: Math.max(BUBBLE_MIN_SIDE, Math.round(BUBBLE_WIDTH / ratio)) };
  return { width: Math.max(BUBBLE_MIN_SIDE, Math.round(BUBBLE_MAX_HEIGHT * ratio)), height: BUBBLE_MAX_HEIGHT };
}
