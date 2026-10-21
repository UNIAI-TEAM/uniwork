// The image viewer's gesture maths (components/chat/zoomable-image.tsx),
// pure so the node tests hold it and marked as worklets so the gestures run
// it on the UI thread. Coordinates are relative to the photo's centre; a
// translation is how far the scaled photo's centre moved from the screen's.

export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;
/** A drag down (or up) this far, or this fast, closes the viewer. */
export const DISMISS_DISTANCE = 120;
export const DISMISS_VELOCITY = 900;

export function clampScale(scale: number): number {
  "worklet";
  return Math.min(MAX_SCALE, Math.max(1, scale));
}

/** A zoomed photo moves only as far as it overflows `size` on that axis. */
export function clampTranslate(value: number, scale: number, size: number): number {
  "worklet";
  const limit = (size * (scale - 1)) / 2;
  return Math.min(limit, Math.max(-limit, value));
}

/** The translation that keeps the point under the fingers (`focal`, from the centre) still while the scale goes from `from` to `to`. */
export function focalTranslate(focal: number, translate: number, from: number, to: number): number {
  "worklet";
  return focal - ((focal - translate) * to) / from;
}

/** A double tap at `point`: in to DOUBLE_TAP_SCALE towards it, or back to the fitted photo. */
export function doubleTapTarget(scale: number, point: { x: number; y: number }, size: { width: number; height: number }): { scale: number; x: number; y: number } {
  "worklet";
  if (scale > 1) return { scale: 1, x: 0, y: 0 };
  const to = DOUBLE_TAP_SCALE;
  return {
    scale: to,
    x: clampTranslate(focalTranslate(point.x - size.width / 2, 0, 1, to), to, size.width),
    y: clampTranslate(focalTranslate(point.y - size.height / 2, 0, 1, to), to, size.height),
  };
}

export function shouldDismiss(translationY: number, velocityY: number): boolean {
  "worklet";
  return Math.abs(translationY) > DISMISS_DISTANCE || Math.abs(velocityY) > DISMISS_VELOCITY;
}
