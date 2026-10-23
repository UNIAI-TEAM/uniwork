/*
 * The UniChat look for ConfirmDialog (common/form-dialog.tsx), dressed from
 * the outside like CHAT_DIALOG_CLASS: 20px corners, 24px padding, a
 * display-face title, and pill buttons on the card instead of a footer band.
 */
export const CHAT_CONFIRM_CLASS = [
  // 400px (canvas); the primitive writes its width on data-[size=default], so this does too.
  "rounded-2xl p-6 data-[size=default]:sm:max-w-100",
  // Tile, 16px, title, 8px, why (canvas).
  "[&_[data-slot=alert-dialog-header]]:gap-2 [&_[data-slot=icon-tile]]:mb-2",
  "[&_[data-slot=alert-dialog-title]]:font-display [&_[data-slot=alert-dialog-title]]:text-title-lg [&_[data-slot=alert-dialog-title]]:font-bold",
  "[&_[data-slot=alert-dialog-footer]]:mx-0 [&_[data-slot=alert-dialog-footer]]:mb-0 [&_[data-slot=alert-dialog-footer]]:gap-2 [&_[data-slot=alert-dialog-footer]]:border-t-0 [&_[data-slot=alert-dialog-footer]]:bg-transparent [&_[data-slot=alert-dialog-footer]]:p-0 [&_[data-slot=alert-dialog-footer]]:pt-2",
  "[&_[data-slot=alert-dialog-footer]_button]:h-10 [&_[data-slot=alert-dialog-footer]_button]:rounded-full [&_[data-slot=alert-dialog-footer]_button]:px-4.5 [&_[data-slot=alert-dialog-footer]_button]:font-semibold",
].join(" ");
