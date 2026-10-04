"use client";

// UNI-924 W-H: bridges between typed ribbon items and the components that own
// their dialog/panel state, plus the helper that keeps such a component mounted
// inside a typed group.
//
// A typed ribbon item is plain data (no hooks) but the dialog/panel it opens
// lives in the group component. The component keeps its own React state (so a
// fresh mount is always closed) and binds its setter to a module-scope
// controller; the typed item calls the controller, and reads `get()` for a
// toggle's `pressed` value.
import { createElement, useState, type ComponentType } from "react";
import type { RibbonCustomItem } from "../../../ribbon";
import type { DocxToolbarGroupContext } from "../types";

export interface RibbonController<T> {
  get: () => T;
  set: (next: T) => void;
  bind: (value: T, setter: (next: T) => void) => void;
}

export function createRibbonController<T>(initial: T): RibbonController<T> {
  let value = initial;
  let setter: ((next: T) => void) | null = null;
  return {
    get: () => value,
    set: (next) => {
      value = next;
      setter?.(next);
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
  bind: (value: boolean, setter: (next: boolean) => void) => void;
}

/** Boolean convenience wrapper over `createRibbonController`. */
export function createRibbonOpenStore(): RibbonOpenStore {
  const controller = createRibbonController(false);
  return {
    get: controller.get,
    open: () => controller.set(true),
    close: () => controller.set(false),
    set: controller.set,
    bind: controller.bind,
  };
}

/**
 * Component-side binding: local React state for the control, re-bound to the
 * module controller on every render so a fresh mount starts closed while the
 * typed item can still drive it.
 */
export function useRibbonBound<T>(controller: RibbonController<T>, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState(initial);
  controller.bind(value, setValue);
  return [value, setValue];
}

/** Boolean shorthand for `useRibbonBound`. */
export function useRibbonOpen(store: RibbonOpenStore): [boolean, (next: boolean) => void] {
  return useRibbonBound(store, false);
}

/**
 * A zero-width `custom` item that keeps a group's component mounted next to its
 * typed items, so the dialog/panel it owns still renders while the ribbon shows
 * real large/small buttons instead of one custom item per group.
 */
export function ribbonHostItem(
  id: string,
  labelKey: string,
  component: ComponentType<DocxToolbarGroupContext>,
  context: DocxToolbarGroupContext,
): RibbonCustomItem {
  return {
    kind: "custom",
    id,
    labelKey,
    width: 0,
    render: () => createElement(component, context),
  };
}

