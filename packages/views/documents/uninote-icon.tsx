/**
 * The UniNote glyph (Documents design, board "Icon UniNote", option 3): a
 * single U whose right stroke ends under a pen. It paints in `currentColor`,
 * so the caller sets the tile and the colour (a tint pair, never a hex).
 */
export function UniNoteIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 100 100" className={className}>
      <path d="M22 14 V56 A28 28 0 0 0 78 56" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" />
      <path d="M68 2 H88 V26 H68 Z M68 30 H88 L78 50 Z M77 33 H79 V43 H77 Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
