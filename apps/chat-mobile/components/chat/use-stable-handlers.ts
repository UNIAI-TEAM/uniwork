// One object of callbacks that never changes identity yet always runs the
// latest closures: what a memoized list cell takes instead of fresh arrow
// functions from every parent render (audit H1). The set of names is fixed at
// the first render; a handler only ever runs from an event, after the commit
// that stored it.
import { useLayoutEffect, useMemo, useRef } from "react";

type Handler = (...args: never[]) => unknown;

export function useStableHandlers<T extends Record<string, Handler>>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  return useMemo(() => {
    const stable: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of Object.keys(latest.current)) {
      stable[name] = (...args) => (latest.current[name] as unknown as (...args: unknown[]) => unknown)(...args);
    }
    return stable as unknown as T;
  }, []);
}
