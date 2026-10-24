import { cn } from "@uniwork/ui/lib/utils";

/**
 * The page geometry (kit `.page` + `.grid`) as container-query classes on
 * `@container/meeting` (the page scroller): 72 side pads, 32 below a full 1440
 * window, 16 on a phone; main and rail 288, the rail stacking above main under
 * 928 of content (kit ≤ 1199 viewport). The kit's 1168 sheet fills the page at
 * 1440; on a wider window the sheet grows (to 1600) and main takes the extra
 * width, so the 72 margins stay as drawn instead of turning into a centred gap.
 */
export const DETAIL_SHEET = cn(
  // At 1440 the page is 1166 (the kit's 1168 inside the sheet's 1px border), so main is 678 beside the rail.
  "mx-auto w-full max-w-[100rem] px-18 pt-7 pb-10 @max-[72rem]/meeting:px-8 @max-[37.5rem]/meeting:px-4 @max-[37.5rem]/meeting:pt-4 @max-[37.5rem]/meeting:pb-12",
  // The roll docked beside the page (LiveSecretary, kit `.page.has-panel`): main slides left, 680 wide.
  "data-[panel=roll]:mx-0 data-[panel=roll]:max-w-none data-[panel=roll]:py-4 data-[panel=roll]:pr-130 data-[panel=roll]:pl-10 data-[panel=roll]:*:max-w-170",
);

export const DETAIL_GRID =
  "grid grid-cols-[minmax(0,1fr)_288px] items-start justify-between gap-x-14 @max-[72rem]/meeting:gap-x-10 @max-[58rem]/meeting:grid-cols-1";

/** The page scroller's id, for the parts that follow its scroll (outline scroll-spy, the docked roll drawer). */
export const DETAIL_SCROLLER_ID = "meeting-detail-scroller";
