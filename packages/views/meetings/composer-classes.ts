// Shared by the room's composers: the UNI composer and the chat tab.

// 15/22 as the plan pins it; 16/24 on touch (canvas phone), where iOS zooms into a smaller field.
export const INPUT_TYPE =
  "text-body-lg md:text-body-lg pointer-coarse:text-title-sm pointer-coarse:leading-6 pointer-coarse:tracking-normal";

// The disabled look is drawn by the colours, not the primitive's half opacity.
export const ROUND = "size-8 rounded-full p-0 pointer-coarse:size-11 aria-disabled:opacity-100 [&_svg]:size-4";
