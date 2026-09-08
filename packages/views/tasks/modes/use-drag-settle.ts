import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * Content equality for the column map (`columnId -> ordered task ids`).
 */
function columnsEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (av === bv) continue;
    if (!av || !bv || av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
  }
  return true;
}

/**
 * Shared drag/settle state machine for the suite board (Multica port).
 *
 * Local columns mirror TanStack Query between drags; while dragging or settling
 * the mirror is frozen so an optimistic move is not clobbered mid-flight.
 */
export function useDragSettle(initialColumns: () => Record<string, string[]>) {
  const isDraggingRef = useRef(false);
  const isSettlingRef = useRef(false);
  const recentlyMovedRef = useRef(false);
  const [settleVersion, setSettleVersion] = useState(0);

  const [columns, setColumnsState] = useState<Record<string, string[]>>(
    initialColumns,
  );
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const setColumns = useCallback<
    Dispatch<SetStateAction<Record<string, string[]>>>
  >((update) => {
    setColumnsState((prev) => {
      const next =
        typeof update === "function"
          ? (update as (p: Record<string, string[]>) => Record<string, string[]>)(
              prev,
            )
          : update;
      return columnsEqual(prev, next) ? prev : next;
    });
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      recentlyMovedRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [columns]);

  const beginSettle = useCallback(() => {
    isSettlingRef.current = true;
    return () => {
      isSettlingRef.current = false;
      setSettleVersion((v) => v + 1);
    };
  }, []);

  return {
    columns,
    setColumns,
    columnsRef,
    isDraggingRef,
    isSettlingRef,
    recentlyMovedRef,
    settleVersion,
    beginSettle,
  };
}
