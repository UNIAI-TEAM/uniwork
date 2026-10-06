"use client";

/**
 * The slide-level edits the editor runs outside the sorter (UNI-958): the Home/Insert
 * "New slide" button and Delete on a slide-rail thumbnail. Both travel the same
 * handle edit port and the same `PptxEdit` kinds as the sorter, so the deck, its
 * history and the dirty flag see one kind of slide edit whichever surface sent it.
 *
 * A new slide is selected once the host re-reads the longer deck: the edit result
 * does not carry the slide list, so the wanted index waits for `slideCount` to reach it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import type { RibbonItem } from "../ribbon";
import { addBlankSlideEdit, deleteSlideEdit } from "./sorter/sorter-edits";

interface PptxSlideCommandsInput {
  /** The handle edit port; absent leaves New slide disabled and Delete inert. */
  edit?: (edits: readonly PptxEdit[]) => Promise<unknown>;
  slideIndex: number;
  slideCount: number;
  selectSlide: (index: number) => void;
  onError: (error: unknown) => void;
}

export function usePptxSlideCommands({ edit, slideIndex, slideCount, selectSlide, onError }: PptxSlideCommandsInput) {
  const [pendingSelect, setPendingSelect] = useState<number | null>(null);
  useEffect(() => {
    if (pendingSelect === null || slideCount <= pendingSelect) return;
    setPendingSelect(null);
    selectSlide(pendingSelect);
  }, [pendingSelect, selectSlide, slideCount]);

  const addSlide = useCallback(() => {
    const next = addBlankSlideEdit(slideIndex);
    if (!edit || !next) return;
    void edit([next]).then(() => setPendingSelect(slideIndex + 1), onError);
  }, [edit, onError, slideIndex]);

  // The engine refuses to delete the last slide; the rail never offers it.
  const deleteSlide = useCallback((index: number) => {
    const next = deleteSlideEdit(index);
    if (!edit || !next || slideCount < 2) return;
    void edit([next]).catch(onError);
  }, [edit, onError, slideCount]);

  /** The Slides group's New slide button (Home and Insert tabs). */
  const slideItems = useMemo<readonly RibbonItem[]>(() => [{
    kind: "button",
    id: "new-slide",
    labelKey: "office.pptx.panels.new_slide",
    icon: Plus,
    size: "large",
    disabled: !edit,
    ...(edit ? {} : { tooltipKey: "office.pptx.reasons.edit_unbound" }),
    onExecute: () => { if (edit) addSlide(); },
  }], [addSlide, edit]);

  return { deleteSlide: edit ? deleteSlide : undefined, slideItems };
}
