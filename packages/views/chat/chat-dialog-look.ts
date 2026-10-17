/*
 * The UniChat look for the shared dialog and sheet primitives. The primitives
 * and common/form-dialog.tsx serve every module, so chat dresses them from the
 * outside through the data-slot hooks they already publish instead of forking
 * them: 20px corners, an open header with a display-face title, a 44px close
 * button, and pill buttons in the footer.
 */

/** For FormDialogContent's className. */
export const CHAT_DIALOG_CLASS = [
  "rounded-2xl",
  "[&_[data-slot=dialog-header]]:border-b-0 [&_[data-slot=dialog-header]]:pt-5 [&_[data-slot=dialog-header]]:pr-16 [&_[data-slot=dialog-header]]:pb-1",
  "[&_[data-slot=dialog-title]]:font-display [&_[data-slot=dialog-title]]:text-title-lg [&_[data-slot=dialog-title]]:font-bold",
  "[&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-close]]:rounded-lg",
  "[&_[data-slot=dialog-footer]]:rounded-b-2xl [&_[data-slot=dialog-footer]]:bg-transparent [&_[data-slot=dialog-footer]]:py-4",
  "[&_[data-slot=dialog-footer]_[data-slot=button]]:h-10 [&_[data-slot=dialog-footer]_[data-slot=button]]:rounded-full [&_[data-slot=dialog-footer]_[data-slot=button]]:px-4 [&_[data-slot=dialog-footer]_[data-slot=button]]:font-semibold",
].join(" ");

/**
 * For SheetContent's className on the right: from sm up the sheet floats 12px
 * off the edges with 20px corners; below sm it stays the full-screen sheet.
 */
export const CHAT_SHEET_CLASS = [
  "flex w-full flex-col gap-0 p-0 sm:max-w-md",
  "sm:data-[side=right]:inset-y-3 sm:data-[side=right]:right-3 sm:data-[side=right]:h-auto sm:data-[side=right]:rounded-2xl sm:data-[side=right]:border",
  "[&_[data-slot=sheet-title]]:font-display [&_[data-slot=sheet-title]]:text-title [&_[data-slot=sheet-title]]:font-bold",
  "[&_[data-slot=sheet-close]]:top-3.5 [&_[data-slot=sheet-close]]:right-3 [&_[data-slot=sheet-close]]:size-11 [&_[data-slot=sheet-close]]:rounded-lg",
].join(" ");

/** Header of a chat sheet: title (and description) clear of the close button. */
export const CHAT_SHEET_HEADER_CLASS = "gap-1 border-b border-border py-4 pr-16 pl-5";

/** The 64px brand-wash tile and display title of a chat empty state. */
export const CHAT_EMPTY_TILE_CLASS = "size-16 rounded-2xl [&_svg]:size-7";
export const CHAT_EMPTY_TITLE_CLASS = "font-display text-title font-bold text-foreground";

/** A small pill action (34px): Join, Open, Play, Create task. */
export const CHAT_PILL_SM_CLASS = "h-8.5 rounded-full px-3.5 text-label font-semibold";
