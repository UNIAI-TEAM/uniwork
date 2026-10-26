/**
 * Class strings the sheet's parts share (kit `.f-label`, `.pchip`, `.role`,
 * the left-check menu rows), so every field draws the same control.
 */

/** Field label (kit `.f-label`): label role, 8px above its control. */
export const FIELD_LABEL = "mb-2 block text-label font-medium text-foreground";

/** A radio menu row with its check on the left (kit `.menu-item` + tick). */
export const MENU_ITEM_LEFT_CHECK =
  "h-9 pr-2.5 pl-8 [&>[data-slot=dropdown-menu-radio-item-indicator]]:right-auto [&>[data-slot=dropdown-menu-radio-item-indicator]]:left-2 data-checked:font-medium";

/** A 36px form control on the page colour (kit `.ctl`); 44 on phone. */
export const CONTROL =
  "h-9 rounded-md border border-input bg-background px-2.5 text-body text-foreground placeholder:text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring max-sm:h-11";

/** Property chip (kit `.pchip`): 32 tall, caption 500, muted key then the value; a 44 hit area on phone. */
export const PROPERTY_CHIP =
  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-sm border border-border px-2.5 text-caption font-medium text-foreground whitespace-nowrap hover:bg-surface-hover aria-expanded:bg-surface-hover max-sm:relative max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:-inset-y-1.5 max-sm:after:content-[''] max-sm:group-data-[phone-sheet]/sheet:h-11 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

/** Role chip (kit `.role`): 28 tall, label 500; a 44 hit area on phone. */
export const ROLE_CHIP =
  "inline-flex h-7 items-center gap-1.5 rounded-sm border border-border px-2 text-label font-medium whitespace-nowrap text-foreground hover:bg-surface-hover aria-expanded:border-input aria-expanded:bg-surface-hover max-sm:relative max-sm:after:absolute max-sm:after:-inset-x-0.5 max-sm:after:-inset-y-2 max-sm:after:content-[''] max-sm:group-data-[mode=edit]/sheet:h-9 max-sm:group-data-[mode=live]/sheet:h-11 max-sm:group-data-[mode=followUp]/sheet:h-11 [&_svg]:size-3";

/** Section heading inside "Thêm tùy chọn" and the carried-over block (kit `.mp h3`). */
export const SECTION_TITLE = "text-title-sm font-semibold";
