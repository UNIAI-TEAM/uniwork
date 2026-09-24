"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type VoiceCallPanelOffset = { x: number; y: number };

const MARGIN = 16;

function clampOffset(x: number, y: number, width: number, height: number): VoiceCallPanelOffset {
  const maxX = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - height - MARGIN);
  return {
    x: Math.min(Math.max(MARGIN, x), maxX),
    y: Math.min(Math.max(MARGIN, y), maxY),
  };
}

/**
 * Drag a fixed call panel; `null` offset means default bottom-right placement.
 * A dragged panel is pulled back inside the viewport whenever the window or
 * the panel changes size (rotate a phone, minimise, expand), so the hang-up
 * control can never end up off screen.
 */
export function useVoiceCallPanelDrag(enabled: boolean, mode?: string) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState<VoiceCallPanelOffset | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!enabled) setOffset(null);
  }, [enabled]);

  const reclamp = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    setOffset((current) => {
      if (current == null) return current;
      const next = clampOffset(current.x, current.y, panel.offsetWidth, panel.offsetHeight);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reclamp();
    window.addEventListener("resize", reclamp);
    const panel = panelRef.current;
    const observer =
      panel && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => reclamp()) : null;
    if (panel) observer?.observe(panel);
    return () => {
      window.removeEventListener("resize", reclamp);
      observer?.disconnect();
    };
  }, [enabled, mode, reclamp]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const current = offset ?? { x: rect.left, y: rect.top };
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: current.x,
        originY: current.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      // First drag: switch from CSS default to explicit coordinates.
      if (offset == null) setOffset({ x: rect.left, y: rect.top });
    },
    [enabled, offset],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !panel) return;
    setOffset(
      clampOffset(
        drag.originX + (event.clientX - drag.startX),
        drag.originY + (event.clientY - drag.startY),
        panel.offsetWidth,
        panel.offsetHeight,
      ),
    );
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const style =
    offset == null
      ? undefined
      : ({
          position: "fixed" as const,
          left: offset.x,
          top: offset.y,
          right: "auto",
          bottom: "auto",
        } as const);

  return {
    panelRef,
    style,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
