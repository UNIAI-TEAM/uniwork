"use client";

/**
 * The slide-level edits the editor runs outside the sorter (UNI-958): the Home/Insert
 * "New slide" button and Delete on a slide-rail thumbnail. Both travel the same
 * handle edit port and the same `PptxEdit` kinds as the sorter, so the deck, its
 * history and the dirty flag see one kind of slide edit whichever surface sent it.
 *
 * A new slide is selected once the host re-reads the longer deck: the edit result
 * does not carry the slide list, so the wanted index waits for the deck to grow past
 * the length it had when the edit was sent.
 * The wait is dropped when the user picks another slide meanwhile, or when the deck
 * changes length without reaching it (r2 L3), so it never fires on a later edit.
 *
 * A slide delete clears the canvas selection first (r2 M1): element ids repeat across
 * slides, so a selection kept by id would land on the next slide's same-id shape.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  clearSelection: () => void;
  onError: (error: unknown) => void;
}

interface PendingSelect {
  index: number;
  /** The slide selected and the deck length when the edit was SENT. */
  from: number;
  count: number;
}

export function usePptxSlideCommands({ edit, slideIndex, slideCount, selectSlide, clearSelection, onError }: PptxSlideCommandsInput) {
  const { t } = useTranslation();
  const latest = useRef({ slideIndex });
  useEffect(() => { latest.current = { slideIndex }; }, [slideIndex]);
  const [pendingSelect, setPendingSelect] = useState<PendingSelect | null>(null);
  useEffect(() => {
    if (!pendingSelect) return;
    if (slideIndex !== pendingSelect.from) { setPendingSelect(null); return; }
    if (slideCount > pendingSelect.count) {
      setPendingSelect(null);
      selectSlide(pendingSelect.index);
    } else if (slideCount < pendingSelect.count) setPendingSelect(null);
  }, [pendingSelect, selectSlide, slideCount, slideIndex]);

  const addSlide = useCallback(() => {
    const next = addBlankSlideEdit(slideIndex);
    if (!edit || !next) return;
    const from = slideIndex;
    const count = slideCount;
    void edit([next]).then(() => {
      if (latest.current.slideIndex !== from) return;
      setPendingSelect({ index: from + 1, from, count });
    }, onError);
  }, [edit, onError, slideCount, slideIndex]);

  // The engine refuses to delete the last slide; say so instead of a silent key (r2 L2).
  const deleteSlide = useCallback((index: number) => {
    const next = deleteSlideEdit(index);
    if (!edit || !next) return;
    if (slideCount < 2) { onError(new Error(t("office.pptx.sorter.disabled_last_slide"))); return; }
    clearSelection();
    void edit([next]).catch(onError);
  }, [clearSelection, edit, onError, slideCount, t]);

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
