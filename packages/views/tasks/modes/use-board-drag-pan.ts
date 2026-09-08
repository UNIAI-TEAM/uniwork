import { useCallback, useEffect, useRef } from "react";

/** Threshold (px) that distinguishes a click from a pan drag. */
const PAN_ACTIVATION_DISTANCE = 5;

const INTERACTIVE_SELECTOR = [
  "[data-board-card]",
  "[data-no-board-pan]",
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='tab']",
  "[role='switch']",
  "[contenteditable='true']",
].join(", ");

/**
 * Blank-area left-drag panning for a horizontally scrollable board
 * (Trello / Linear-style pattern).
 */
export function useBoardDragPan<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const startXRef = useRef(0);
  const lastXRef = useRef(0);

  const beginSelectionSuppression = useCallback((el: T) => {
    el.style.userSelect = "none";
    el.style.setProperty("-webkit-user-select", "none");
  }, []);

  const reset = useCallback(() => {
    const el = ref.current;
    if (el && pointerIdRef.current !== null) {
      try {
        el.releasePointerCapture(pointerIdRef.current);
      } catch {
        /* capture already released */
      }
    }
    pointerIdRef.current = null;
    activeRef.current = false;
    if (el) {
      el.style.removeProperty("cursor");
      el.style.removeProperty("user-select");
      el.style.removeProperty("-webkit-user-select");
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<T>) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      const el = ref.current;
      if (!el) return;
      const target = event.target as Element | null;
      if (target && target.closest(INTERACTIVE_SELECTOR)) return;

      pointerIdRef.current = event.pointerId;
      activeRef.current = false;
      startXRef.current = event.clientX;
      lastXRef.current = event.clientX;
      beginSelectionSuppression(el);
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* unsupported */
      }
      event.preventDefault();
    },
    [beginSelectionSuppression],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<T>) => {
      if (
        pointerIdRef.current === null ||
        event.pointerId !== pointerIdRef.current
      ) {
        return;
      }
      const el = ref.current;
      if (!el) return;

      if ((event.buttons & 1) === 0) {
        reset();
        return;
      }

      if (!activeRef.current) {
        if (Math.abs(event.clientX - startXRef.current) < PAN_ACTIVATION_DISTANCE)
          return;
        activeRef.current = true;
        el.style.cursor = "grabbing";
      }

      const delta = event.clientX - lastXRef.current;
      lastXRef.current = event.clientX;
      const maxScroll = el.scrollWidth - el.clientWidth;
      const next = Math.min(
        Math.max(el.scrollLeft - delta, 0),
        Math.max(maxScroll, 0),
      );
      el.scrollLeft = next;
      event.preventDefault();
    },
    [reset],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<T>) => {
      if (event.pointerId !== pointerIdRef.current) return;
      reset();
    },
    [reset],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const veto = (event: Event) => {
      if (pointerIdRef.current !== null) event.preventDefault();
    };
    el.addEventListener("selectstart", veto);
    el.addEventListener("dragstart", veto);
    return () => {
      el.removeEventListener("selectstart", veto);
      el.removeEventListener("dragstart", veto);
    };
  }, []);

  useEffect(() => {
    const handleBlur = () => reset();
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [reset]);

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
  };
}
