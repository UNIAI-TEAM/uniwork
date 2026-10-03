"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

/**
 * What a nested surface contributes to the page header it renders under:
 * `actions` sit in the header's action cluster, `menuItems` in the page's
 * overflow (⋯) menu. Either may be omitted.
 */
export interface HeaderActionsEntry {
  actions?: ReactNode;
  menuItems?: ReactNode;
}

type Entry = readonly [id: string, entry: HeaderActionsEntry];

interface Registry {
  set(id: string, entry: HeaderActionsEntry | null): void;
}

const RegistryContext = createContext<Registry | null>(null);
const EntriesContext = createContext<readonly Entry[]>([]);

function sameEntry(left: HeaderActionsEntry, right: HeaderActionsEntry): boolean {
  return Object.is(left.actions, right.actions) && Object.is(left.menuItems, right.menuItems);
}

/**
 * The page that owns the header provides the slot. A surface below it (the
 * Office editor) fills it, so a page shows one header instead of stacking the
 * editor's own header under the page's. No portal: the content is rendered by
 * the header itself, inside the same React tree and contexts.
 */
export function HeaderActionsSlotProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const registry = useMemo<Registry>(() => ({
    set(id, entry) {
      setEntries((previous) => {
        const index = previous.findIndex(([key]) => key === id);
        if (!entry) return index === -1 ? previous : previous.filter(([key]) => key !== id);
        if (index === -1) return [...previous, [id, entry] as const];
        if (sameEntry(previous[index]![1], entry)) return previous;
        const next = previous.slice();
        next[index] = [id, entry] as const;
        return next;
      });
    },
  }), []);
  return (
    <RegistryContext.Provider value={registry}>
      <EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
    </RegistryContext.Provider>
  );
}

/** True when a page header above this surface accepts header actions. */
export function useHeaderActionsSlotAvailable(): boolean {
  return useContext(RegistryContext) !== null;
}

/** True when some surface currently contributes header actions. */
export function useHeaderActionsSlotFilled(): boolean {
  return useContext(EntriesContext).some(([, entry]) => entry.actions != null);
}

/** Hands `actions` / `menuItems` to the nearest page header; renders nothing. */
export function HeaderActionsFill({ actions, menuItems }: HeaderActionsEntry) {
  const registry = useContext(RegistryContext);
  const id = useId();
  useEffect(() => {
    registry?.set(id, { actions, menuItems });
  });
  useEffect(() => () => registry?.set(id, null), [registry, id]);
  return null;
}

/** Renders the contributed action clusters, in registration order. */
export function HeaderActionsSlot() {
  const entries = useContext(EntriesContext);
  const filled = entries.filter(([, entry]) => entry.actions != null);
  if (filled.length === 0) return null;
  return (
    <>
      {filled.map(([id, entry]) => (
        <div key={id} className="flex min-w-0 shrink-0 items-center gap-1" data-header-actions-slot>
          {entry.actions}
        </div>
      ))}
    </>
  );
}

/** Renders the contributed overflow-menu items; place inside a menu popup. */
export function HeaderActionsMenuItems() {
  const entries = useContext(EntriesContext);
  return (
    <>
      {entries.filter(([, entry]) => entry.menuItems != null).map(([id, entry]) => (
        <div key={id} role="none" className="contents" data-header-menu-slot>{entry.menuItems}</div>
      ))}
    </>
  );
}
