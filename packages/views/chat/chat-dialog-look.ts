/*
 * The UniChat look for the shared dialog and sheet primitives. The primitives
 * and common/form-dialog.tsx serve every module, so chat dresses them from the
 * outside through the data-slot hooks they already publish instead of forking
 * them: 20px corners, an open header with a display-face title, a 44px close
 * button, and pill buttons in the footer.
 */

/** For FormDialogContent's className (canvas: 24px gutters, 20px corners, footer on a hairline). */
export const CHAT_DIALOG_CLASS = [
  "rounded-2xl",
  "[&_[data-slot=dialog-header]]:gap-1 [&_[data-slot=dialog-header]]:border-b-0 [&_[data-slot=dialog-header]]:pt-6 [&_[data-slot=dialog-header]]:pr-18 [&_[data-slot=dialog-header]]:pb-0 [&_[data-slot=dialog-header]]:pl-6",
  "[&_[data-slot=dialog-title]]:font-display [&_[data-slot=dialog-title]]:text-title-lg [&_[data-slot=dialog-title]]:font-bold",
  "[&_[data-slot=dialog-close]]:top-3.5 [&_[data-slot=dialog-close]]:right-3.5 [&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-close]]:rounded-lg [&_[data-slot=dialog-close]_svg]:size-5",
  "[&_[data-slot=dialog-footer]]:mt-4 [&_[data-slot=dialog-footer]]:gap-3 [&_[data-slot=dialog-footer]]:rounded-b-2xl [&_[data-slot=dialog-footer]]:border-border [&_[data-slot=dialog-footer]]:bg-transparent [&_[data-slot=dialog-footer]]:px-6 [&_[data-slot=dialog-footer]]:pt-4 [&_[data-slot=dialog-footer]]:pb-5",
  "[&_[data-slot=form-dialog-leading]]:text-label",
  "[&_[data-slot=dialog-footer]_[data-slot=button]]:h-10 [&_[data-slot=dialog-footer]_[data-slot=button]]:rounded-full [&_[data-slot=dialog-footer]_[data-slot=button]]:px-4.5 [&_[data-slot=dialog-footer]_[data-slot=button]]:text-body [&_[data-slot=dialog-footer]_[data-slot=button]]:font-semibold",
].join(" ");

/** With CHAT_DIALOG_CLASS for a one-field dialog (rename, nickname): the buttons sit on the card, no hairline. */
export const CHAT_DIALOG_COMPACT_CLASS =
  "[&_[data-slot=dialog-header]]:pr-6 [&_[data-slot=dialog-title]]:pr-10 [&_[data-slot=dialog-footer]]:mt-0 [&_[data-slot=dialog-footer]]:gap-2 [&_[data-slot=dialog-footer]]:border-t-0 [&_[data-slot=dialog-footer]]:pt-6 [&_[data-slot=dialog-footer]]:pb-6";

/** FormDialogBody's className in a chat dialog: 24px gutters, 20px under the header (a dialog's own classes go after it). */
export const CHAT_DIALOG_BODY_CLASS = "px-6 pt-5 pb-1";

/** The canvas widths: 560 for a picker or a form, 480 for a short one, 456 for a single field. */
export const CHAT_DIALOG_WIDTH = { form: "sm:max-w-140", narrow: "sm:max-w-120", field: "sm:max-w-114" } as const;

/**
 * For SheetContent's className on the right: from sm up the sheet floats 12px
 * off the edges with 20px corners; below sm it stays the full-screen sheet.
 */
export const CHAT_SHEET_CLASS = [
  // Same variant order as the primitive's w-3/4 and sm:max-w-sm, so cn() drops those instead of letting them win.
  "flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md",
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

/** A dialog field (Input/Textarea className): the canvas' 44px muted well with 12px corners; white with the ring while focused. */
export const CHAT_FIELD_CLASS =
  "h-11 rounded-lg border-border bg-muted px-3.5 md:text-body-lg dark:bg-muted focus-visible:border-primary focus-visible:bg-surface focus-visible:ring-3 focus-visible:ring-brand-subtle dark:focus-visible:bg-surface";

/** A section label over a list in a dialog ("THÀNH VIÊN WORKSPACE"): small tracked capitals in the copy face. */
export const CHAT_SECTION_LABEL_CLASS = "text-caption font-semibold tracking-[0.06em] text-muted-foreground uppercase";

/** A multi-line field: the same well, 11px/14px insets and 21px lines, no resize grip. */
export const CHAT_FIELD_TEXTAREA_CLASS = `${CHAT_FIELD_CLASS} h-auto resize-none py-2.5 leading-[1.4]`;

/** A field label over a chat dialog field: 13px semibold, the required mark tight after it. */
export const CHAT_LABEL_CLASS = "gap-0 text-label font-semibold text-foreground";

/** The canvas switch: 44×26 with a 20px thumb, a light track while off. */
export const CHAT_SWITCH_CLASS =
  "data-[size=default]:h-6.5 data-[size=default]:w-11 px-0.5 data-unchecked:bg-input/40 dark:data-unchecked:bg-input/60 *:data-[slot=switch-thumb]:size-5!";

/** A Select trigger dressed as the same 44px well (the canvas' project and repeat pickers). */
export const CHAT_SELECT_TRIGGER_CLASS =
  "min-h-11 w-full gap-2.5 rounded-lg border-border bg-muted px-3.5 md:text-body-lg dark:bg-muted";

/** DateTimeField's className: day and time side by side, both as 44px wells (canvas deadline / reminder). */
export const CHAT_DATETIME_CLASS = [
  "grid-cols-2",
  "[&_[data-slot=popover-trigger]]:min-h-11 [&_[data-slot=popover-trigger]]:gap-2.5 [&_[data-slot=popover-trigger]]:rounded-lg [&_[data-slot=popover-trigger]]:border-border [&_[data-slot=popover-trigger]]:bg-muted [&_[data-slot=popover-trigger]]:px-3.5 md:[&_[data-slot=popover-trigger]]:text-body-lg dark:[&_[data-slot=popover-trigger]]:bg-muted",
  "[&_[data-slot=time-input]]:min-h-11 [&_[data-slot=time-input]]:gap-0.5 [&_[data-slot=time-input]]:rounded-lg [&_[data-slot=time-input]]:border-border [&_[data-slot=time-input]]:bg-muted [&_[data-slot=time-input]]:px-3.5 dark:[&_[data-slot=time-input]]:bg-muted",
  "[&_[data-slot=time-input]>svg]:mr-2 [&_[data-slot=time-input]>svg]:size-4.5 [&_[data-slot=time-input]_input]:text-body-lg",
].join(" ");

/** "Thứ Ba, 22/10": how a picked day reads in a chat date field. */
export const CHAT_DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long", day: "2-digit", month: "2-digit" };
