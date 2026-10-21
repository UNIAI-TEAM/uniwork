// A bottom sheet's drag (components/ui/bottom-sheet.tsx), pure so the node
// tests hold it and marked as worklets so the gesture runs it on the UI thread.
// Only a downward drag moves a sheet (it has no taller detent to grow into);
// letting go past a share of its height, or flicking it down, closes it, as a
// UISheetPresentationController or a Material bottom sheet does.

/** The farthest a drag needs to go to close a tall sheet; a short sheet closes at 40 % of its height. */
export const SHEET_CLOSE_DISTANCE = 140;
const SHEET_CLOSE_SHARE = 0.4;
/** A downward flick this fast (pt/s) closes the sheet from any distance. */
export const SHEET_CLOSE_VELOCITY = 900;

/** How far the sheet follows a drag: down with the finger, never above where it rests. */
export function sheetOffset(translationY: number): number {
  "worklet";
  return Math.max(0, translationY);
}

/** Whether letting go here closes the sheet; `height` is the sheet's measured height (0 before its first layout). */
export function shouldCloseSheet(translationY: number, velocityY: number, height: number): boolean {
  "worklet";
  if (translationY <= 0) return false;
  const distance = height > 0 ? Math.min(SHEET_CLOSE_DISTANCE, height * SHEET_CLOSE_SHARE) : SHEET_CLOSE_DISTANCE;
  return translationY > distance || velocityY > SHEET_CLOSE_VELOCITY;
}
