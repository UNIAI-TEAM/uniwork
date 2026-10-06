"use client";

// UNI-924 W-H: bridges between typed ribbon items and the components that own
// their dialog/panel state.
//
// A typed ribbon item is plain data (no hooks) but the dialog/panel it opens
// lives in the group component. The component keeps its own React state (so a
// fresh mount is always closed) and binds its setter to a module-scope
// controller; the typed item calls the controller, and reads `get()` for a
// toggle's `pressed` value.
//
// F7 (W-FIX-D): the ribbon mounts items inline at stages 0-2, but inside a
// TRANSIENT popover at stage 3 and in the simplified (phone) layout, so a
// dialog rendered from the item tree dies with that popover. Every dialog/panel
// owner is therefore registered at MODULE scope (`registerRibbonDialogHost`) and
// rendered once by `RibbonDialogHosts`, which the toolbar shell mounts outside
// the collapsing item tree - a dialog now survives the group folding and an
// outside press. `ribbonHostItem` stays as a zero-width marker item so the
// group's item list keeps its documented shape and width estimate.
import { createElement, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { RibbonCustomItem } from "../../../ribbon";
import type { DocxDocumentScope } from "../../editor-store";
import type { DocxToolbarGroupContext } from "../types";

export interface RibbonController<T> {
  get: () => T;
  set: (next: T) => void;
  /** Subscribe to changes, for a component that renders the live value (F6). */
  subscribe: (listener: () => void) => () => void;
  bind: (value: T, setter: (next: T) => void) => void;
}

function createRibbonController<T>(initial: T): RibbonController<T> {
  let value = initial;
  let setter: ((next: T) => void) | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      setter?.(next);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bind: (next, set) => {
      value = next;
      setter = set;
    },
  };
}

export interface RibbonOpenStore {
  get: () => boolean;
  open: () => void;
  close: () => void;
  set: (next: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  bind: (value: boolean, setter: (next: boolean) => void) => void;
}

/** Boolean convenience wrapper over `createRibbonController`. */
function createRibbonOpenStore(): RibbonOpenStore {
  const controller = createRibbonController(false);
  return {
    get: controller.get,
    open: () => controller.set(true),
    close: () => controller.set(false),
    set: controller.set,
    subscribe: controller.subscribe,
    bind: controller.bind,
  };
}

/**
 * UNI-957: the desktop keeps hidden document tabs mounted, so a module-scope
 * controller would be bound by whichever document mounted last. These factories
 * return a per-document lookup (lazily created, keyed by the document scope).
 */
export function scopedRibbonController<T>(initial: T): (scope: DocxDocumentScope) => RibbonController<T> {
  const byScope = new WeakMap<DocxDocumentScope, RibbonController<T>>();
  return (scope) => {
    let controller = byScope.get(scope);
    if (!controller) {
      controller = createRibbonController(initial);
      byScope.set(scope, controller);
    }
    return controller;
  };
}

/** Boolean per-document open store; see `scopedRibbonController`. */
export function scopedRibbonOpenStore(): (scope: DocxDocumentScope) => RibbonOpenStore {
  const byScope = new WeakMap<DocxDocumentScope, RibbonOpenStore>();
  return (scope) => {
    let store = byScope.get(scope);
    if (!store) {
      store = createRibbonOpenStore();
      byScope.set(scope, store);
    }
    return store;
  };
}

/**
 * Component-side binding: local React state for the control, re-bound to the
 * module controller after each render so a fresh mount starts closed while the
 * typed item can still drive it. Binding lives in an effect rather than in the
 * render pass - a render-phase side effect fires on every concurrent render
 * attempt, and the previous version also re-bound a stale value.
 */
export function useRibbonBound<T>(controller: RibbonController<T>, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    controller.bind(value, setValue);
  }, [controller, value]);
  return [value, setValue];
}

/** Boolean shorthand for `useRibbonBound`. */
export function useRibbonOpen(store: RibbonOpenStore): [boolean, (next: boolean) => void] {
  return useRibbonBound(store, false);
}

/**
 * Live read of a controller for a component that must show the CURRENT value
 * (F6): re-renders whenever `set` runs, and `set` is the store's own writer,
 * so the value cannot desync from the store the way a bound local copy can.
 */
export function useRibbonLive<T>(controller: RibbonController<T>): T {
  return useSyncExternalStore(controller.subscribe, controller.get, controller.get);
}

/** Boolean shorthand for `useRibbonLive`. */
export function useRibbonOpenLive(store: RibbonOpenStore): boolean {
  return useRibbonLive(store);
}

/**
 * Dialog/panel owners, keyed by the id of the host marker item that names them.
 * Registration happens at module import (see `registerRibbonDialogHost`), so the
 * mount is independent of whether the ribbon currently renders the group's
 * items inline, in a folded popover or in the simplified layout.
 */
const dialogHosts = new Map<string, ComponentType<DocxToolbarGroupContext>>();

/** Register a group's dialog/panel owner. Called once per module, at import. */
export function registerRibbonDialogHost(id: string, component: ComponentType<DocxToolbarGroupContext>): void {
  dialogHosts.set(id, component);
}

/**
 * The fold-proof mount for every typed group's dialog/panel: the toolbar shell
 * renders this once, outside the collapsing item tree, so a dialog keeps living
 * after the group that owns it folds into a popover.
 */
export function RibbonDialogHosts(context: DocxToolbarGroupContext): ReactNode {
  return createElement(
    "div",
    { "data-ribbon-dialog-hosts": "", className: "contents" },
    [...dialogHosts.entries()].map(([id, component]) => createElement(component, { key: id, ...context })),
  );
}

/**
 * A zero-width `custom` marker item for a group's dialog/panel owner. The
 * component itself is mounted by `RibbonDialogHosts`, not in the item tree, so
 * folding the group cannot destroy it; the marker keeps the group's item list
 * and width estimate unchanged.
 */
export function ribbonHostItem(id: string, labelKey: string): RibbonCustomItem {
  return {
    kind: "custom",
    id,
    labelKey,
    width: 0,
    render: () => null,
  };
}
