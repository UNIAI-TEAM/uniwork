"use client";
import { useEffect, useState } from "react";

/**
 * The value, but only after it has stopped changing for `delayMs`. A search
 * box wired straight to a query fires one request per keystroke, which the
 * console's own rate limit then counts against the person typing.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setSettled(value);
      return;
    }
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
