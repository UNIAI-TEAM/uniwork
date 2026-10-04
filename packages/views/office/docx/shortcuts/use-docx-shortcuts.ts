"use client";

import { useEffect, useRef } from "react";
import {
  getShortcutPlatform,
  isPortalLayerShortcutTarget,
  shouldIgnoreGlobalShortcutEvent,
  type ShortcutPlatform,
} from "@uniwork/core/shortcuts";
import { resolveDocxShortcut, type DocxShortcut, type DocxShortcutId } from "./shortcut-map";

export type DocxShortcutHandler = (event: KeyboardEvent, shortcut: DocxShortcut) => void;
export type DocxShortcutHandlers = Partial<Record<DocxShortcutId, DocxShortcutHandler>>;

/**
 * The typing-context rule. The DOCX document surface is itself
 * `contenteditable`, so contenteditables are the document (formatting chords
 * must reach them); the fields this must not steal chords from are the text
 * controls the editor chrome mounts — find, search and the pickers. A host
 * with a second editor inside the same target can override the predicate.
 */
export function isDocxShortcutInputTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return target.closest("input, textarea, select") !== null;
}

export interface DocxShortcutControllerOptions {
  /** Defaults to the platform the core shortcut store resolves. */
  platform?: ShortcutPlatform;
  isInputTarget?: (target: EventTarget | null) => boolean;
  /** Defaults to the core rule: an open dialog/menu owns the keyboard. */
  isLayerTarget?: (target: EventTarget | null) => boolean;
  /** Defaults to the core rule: skip prevented, repeating and IME events. */
  shouldIgnore?: (event: KeyboardEvent) => boolean;
}

export interface DocxShortcutController {
  /** Resolves one keydown; true when a bound chord fired (and was prevented). */
  handle(event: KeyboardEvent): boolean;
  attach(target: EventTarget): void;
  detach(): void;
}

/**
 * Binds the map to handlers. `preventDefault` happens only for a chord that
 * actually has a handler, so an unbound key keeps its native behaviour.
 * Handlers may be passed as a function so a React caller can hand over a fresh
 * object each render without re-attaching.
 */
export function createDocxShortcutController(
  handlers: DocxShortcutHandlers | (() => DocxShortcutHandlers),
  options: DocxShortcutControllerOptions = {},
): DocxShortcutController {
  const getHandlers = typeof handlers === "function" ? handlers : () => handlers;
  const isInputTarget = options.isInputTarget ?? isDocxShortcutInputTarget;
  const isLayerTarget = options.isLayerTarget ?? isPortalLayerShortcutTarget;
  const shouldIgnore = options.shouldIgnore ?? shouldIgnoreGlobalShortcutEvent;
  let attached: EventTarget | null = null;

  const handle = (event: KeyboardEvent): boolean => {
    if (shouldIgnore(event)) return false;
    const shortcut = resolveDocxShortcut(event, options.platform ?? getShortcutPlatform());
    if (!shortcut) return false;
    const handler = getHandlers()[shortcut.id];
    if (!handler) return false;
    // An open dialog or menu owns the keyboard even for a global chord.
    if (isLayerTarget(event.target)) return false;
    // A text field keeps its own keys unless the chord is global.
    if (!shortcut.global && isInputTarget(event.target)) return false;
    event.preventDefault();
    handler(event, shortcut);
    return true;
  };

  const onKeyDown = (event: Event): void => {
    handle(event as KeyboardEvent);
  };

  const detach = (): void => {
    if (!attached) return;
    attached.removeEventListener("keydown", onKeyDown);
    attached = null;
  };

  return {
    handle,
    attach(target) {
      detach();
      attached = target;
      target.addEventListener("keydown", onKeyDown);
    },
    detach,
  };
}

export interface DocxShortcutHookOptions extends DocxShortcutControllerOptions {
  /** Where keydowns are observed; defaults to the document. Null disables. */
  target?: EventTarget | null;
  enabled?: boolean;
}

/**
 * React binding for the controller: attach once per target, read the latest
 * handlers through a ref so a re-render never rebinds.
 */
export function useDocxShortcuts(handlers: DocxShortcutHandlers, options: DocxShortcutHookOptions = {}): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const { target, enabled = true, platform, isInputTarget, isLayerTarget, shouldIgnore } = options;

  useEffect(() => {
    const resolvedTarget = target === undefined ? (typeof document === "undefined" ? null : document) : target;
    if (!enabled || !resolvedTarget) return undefined;
    const controller = createDocxShortcutController(() => handlersRef.current, {
      platform,
      isInputTarget,
      isLayerTarget,
      shouldIgnore,
    });
    controller.attach(resolvedTarget);
    return () => controller.detach();
  }, [enabled, isInputTarget, isLayerTarget, platform, shouldIgnore, target]);
}
