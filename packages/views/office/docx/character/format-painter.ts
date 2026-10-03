"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocxCharacterCommands } from "../commands/character";
import type { DocxEditorHandle, DocxSelection } from "../types";

type PainterCommands = Pick<
  DocxCharacterCommands,
  "copyCharacterFormat" | "applyCharacterFormat" | "clearCharacterFormat"
>;

export interface FormatPainter {
  /** True while the brush holds a captured formatting and is waiting for the
   * next selection. */
  armed: boolean;
  /** Arm (capture the current selection's formatting) or cancel. */
  toggle(): void;
  /** Disarm without applying. */
  cancel(): void;
}

export interface FormatPainterOptions {
  editor: DocxEditorHandle;
  commands?: PainterCommands;
  disabled: boolean;
}

/**
 * Word's format painter over the command seam: the button captures character
 * formatting, and the NEXT selection change applies it and disarms. Escape,
 * a second press, or the document turning read-only cancels an armed brush.
 */
export function useFormatPainter({ editor, commands, disabled }: FormatPainterOptions): FormatPainter {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const pickupRef = useRef<DocxSelection | null>(null);

  const cancel = useCallback(() => {
    if (!armedRef.current) return;
    armedRef.current = false;
    pickupRef.current = null;
    commands?.clearCharacterFormat();
    setArmed(false);
  }, [commands]);

  const toggle = useCallback(() => {
    if (disabled || !commands || !editor.selection?.subscribe) return;
    if (armedRef.current) {
      cancel();
      return;
    }
    if (!commands.copyCharacterFormat()) return;
    pickupRef.current = editor.selection.getSelection();
    armedRef.current = true;
    setArmed(true);
  }, [cancel, commands, disabled, editor]);

  useEffect(() => {
    if (!armed) return undefined;
    const port = editor.selection;
    if (!port?.subscribe) return undefined;
    const pickup = pickupRef.current;
    return port.subscribe((selection) => {
      if (!armedRef.current) return;
      const moved = !pickup || !selection || selection.from !== pickup.from || selection.to !== pickup.to;
      if (!moved) return;
      armedRef.current = false;
      pickupRef.current = null;
      commands?.applyCharacterFormat();
      setArmed(false);
    });
  }, [armed, commands, editor]);

  useEffect(() => {
    if (!armed) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [armed, cancel]);

  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  return { armed, toggle, cancel };
}
