export const UI_EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const UI_MOTION_DURATION = {
  micro: 0.1,
  fast: 0.15,
  standard: 0.2,
} as const;

export const UI_MOTION_DISTANCE = {
  subtle: 6,
  panel: 12,
} as const;

/** Base UI keeps mounted popups through these transition states. */
export const UI_OVERLAY_TRANSITION_CLASS =
  "transition-opacity duration-150 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-opacity";

export const UI_MODAL_TRANSITION_CLASS =
  "origin-center transition-[opacity,transform] duration-200 ease-out data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0 motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100 motion-reduce:transition-opacity";

export const UI_FLOATING_TRANSITION_CLASS =
  "origin-(--transform-origin) transition-[opacity,transform] duration-150 ease-out data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=bottom]:data-ending-style:-translate-y-1 data-[side=inline-end]:data-starting-style:-translate-x-1 data-[side=inline-end]:data-ending-style:-translate-x-1 data-[side=inline-start]:data-starting-style:translate-x-1 data-[side=inline-start]:data-ending-style:translate-x-1 data-[side=left]:data-starting-style:translate-x-1 data-[side=left]:data-ending-style:translate-x-1 data-[side=right]:data-starting-style:-translate-x-1 data-[side=right]:data-ending-style:-translate-x-1 data-[side=top]:data-starting-style:translate-y-1 data-[side=top]:data-ending-style:translate-y-1 motion-reduce:transform-none motion-reduce:transition-opacity";
