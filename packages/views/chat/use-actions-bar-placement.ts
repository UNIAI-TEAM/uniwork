import { useEffect, type RefObject } from "react";

/** Gap kept between the bar and the timeline's top edge. */
const EDGE = 8;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * The actions bar floats above its bubble, but the first message under the
 * conversation header has no room there: the header and pin bar sit outside
 * the scroller and would cover the bar. Each time the message is hovered or
 * focused, the bar drops inside the bubble's top edge (`data-place="inside"`)
 * when the space above it is shorter than the bar.
 */
export function useActionsBarPlacement(barRef: RefObject<HTMLDivElement | null>, mounted: boolean): void {
  useEffect(() => {
    const bar = barRef.current;
    const group = bar?.closest<HTMLElement>(".group\\/message");
    if (!bar || !group) return;
    const place = () => {
      const anchor = bar.offsetParent instanceof HTMLElement ? bar.offsetParent : bar.parentElement;
      const scroller = scrollParent(bar);
      if (!anchor || !scroller) return;
      const room = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const inside = room < bar.offsetHeight + EDGE;
      bar.dataset.place = inside ? "inside" : "above";
      // A bubble that starts under the header: hang the bar from the visible top, not the hidden one.
      bar.style.top = inside ? `${Math.max(EDGE, EDGE - room)}px` : "";
    };
    group.addEventListener("pointerenter", place);
    group.addEventListener("focusin", place);
    return () => {
      group.removeEventListener("pointerenter", place);
      group.removeEventListener("focusin", place);
    };
  }, [barRef, mounted]);
}
