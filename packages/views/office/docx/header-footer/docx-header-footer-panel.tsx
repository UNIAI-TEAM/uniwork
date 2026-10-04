"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocxHeaderFooter, DocxHfSlot } from "@uniwork/office-engine/docx";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { DocxHeaderFooterPreview } from "./docx-header-footer-preview";
import {
  DOCX_HF_SLOTS,
  hasHfSlotContent,
  headerFooterKindOf,
  type DocxHeaderFooterState,
  type DocxHfSlotState,
} from "./header-footer-state";
import { applyHfText, hfDraftIsEmpty, hfEditText } from "./header-footer-text";

/** i18n key per slot; the same suffix names the testid. */
const SLOT_LABEL_KEYS: Record<DocxHfSlot, string> = {
  header: "office.docx.headerFooter.slot.header",
  footer: "office.docx.headerFooter.slot.footer",
  headerFirst: "office.docx.headerFooter.slot.headerFirst",
  footerFirst: "office.docx.headerFooter.slot.footerFirst",
  headerEven: "office.docx.headerFooter.slot.headerEven",
  footerEven: "office.docx.headerFooter.slot.footerEven",
};

/** The draft only belongs to (slot, base content); anything else falls back to the part. */
interface DocxHfDraft {
  slot: DocxHfSlot;
  base: string;
  text: string;
}

export interface DocxHeaderFooterPanelProps {
  /** The six slots of the open document (readDocxHeaderFooterState). */
  state: DocxHeaderFooterState;
  readOnly?: boolean;
  /** A save is in flight; edits are blocked until it settles. */
  saving?: boolean;
  /** Page number the preview substitutes for {PAGE}; 1 when absent. */
  pageNo?: number | string;
  /** Total the preview substitutes for {NUMPAGES}; 1 when absent. */
  pageTotal?: number;
  initialSlot?: DocxHfSlot;
  /** null clears the slot (the model writes the empty-text carrier). */
  onSetSlot: (slot: DocxHfSlot, hf: DocxHeaderFooter | null) => void;
  onSetTitlePg: (value: boolean) => void;
  onSetEvenOdd: (value: boolean) => void;
}

/**
 * Task A13: header/footer editing panel on top of the existing header/footer
 * ops. It picks a slot (showing which ones carry content), edits the slot's
 * text with the run formatting the part already has, previews with the real
 * strip renderer, toggles the first/even variants and clears a slot. All edits
 * leave through the callbacks as the existing set_header_footer / set_title_pg
 * / set_even_odd_headers edits; the panel itself never touches the save path.
 */
export function DocxHeaderFooterPanel({
  state,
  readOnly = false,
  saving = false,
  pageNo = 1,
  pageTotal = 1,
  initialSlot = "header",
  onSetSlot,
  onSetTitlePg,
  onSetEvenOdd,
}: DocxHeaderFooterPanelProps) {
  const { t } = useTranslation();
  const editorId = useId();
  const titlePgLabelId = useId();
  const evenOddLabelId = useId();
  const [slot, setSlot] = useState<DocxHfSlot>(initialSlot);
  const [heldDraft, setHeldDraft] = useState<DocxHfDraft | null>(null);

  const blocked = readOnly || saving;
  /** Switching slots abandons an unapplied draft (the draft belongs to the
   * slot it was typed in); a same-slot return therefore starts from the part. */
  const selectSlot = (next: DocxHfSlot): void => {
    if (next === slot) return;
    setHeldDraft(null);
    setSlot(next);
  };
  const slotState: DocxHfSlotState = state.slots[slot];
  const current = slotState.value;
  const currentText = hfEditText(current);
  const draft = heldDraft && heldDraft.slot === slot && heldDraft.base === currentText ? heldDraft.text : currentText;
  const dirty = draft !== currentText;
  const previewValue = dirty ? applyHfText(current, draft) : current;
  const previewEmpty = dirty ? hfDraftIsEmpty(draft) : current === null;
  const slotLabel = t(SLOT_LABEL_KEYS[slot]);

  const apply = (): void => {
    if (blocked || !dirty) return;
    onSetSlot(slot, applyHfText(current, draft));
  };
  const clear = (): void => {
    if (blocked || !hasHfSlotContent(slotState)) return;
    onSetSlot(slot, null);
  };

  return (
    <div className="grid gap-4" data-testid="docx-header-footer-panel">
      <div className="grid gap-1.5">
        <span className="text-label text-muted-foreground">{t("office.docx.headerFooter.slots")}</span>
        <div role="group" aria-label={t("office.docx.headerFooter.slots")} className="flex flex-wrap gap-1.5">
          {DOCX_HF_SLOTS.map((option) => {
            const active = option === slot;
            const hasContent = hasHfSlotContent(state.slots[option]);
            return (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={active ? "brand" : "outline"}
                aria-pressed={active}
                data-testid={`docx-hf-slot-${option}`}
                data-has-content={hasContent ? "true" : "false"}
                onClick={() => selectSlot(option)}
              >
                <span>{t(SLOT_LABEL_KEYS[option])}</span>
                {hasContent ? (
                  <>
                    <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    <span className="sr-only">{t("office.docx.headerFooter.hasContent")}</span>
                  </>
                ) : null}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-label text-muted-foreground">{t("office.docx.headerFooter.variants")}</span>
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-0.5">
            <span id={titlePgLabelId} className="text-body">
              {t("office.docx.headerFooter.titlePg")}
            </span>
            <span className="text-caption text-muted-foreground">{t("office.docx.headerFooter.titlePgHint")}</span>
          </div>
          <Switch
            aria-labelledby={titlePgLabelId}
            data-testid="docx-hf-title-pg"
            checked={state.titlePg}
            disabled={blocked}
            onCheckedChange={(next) => onSetTitlePg(next === true)}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-0.5">
            <span id={evenOddLabelId} className="text-body">
              {t("office.docx.headerFooter.evenOdd")}
            </span>
            <span className="text-caption text-muted-foreground">{t("office.docx.headerFooter.evenOddHint")}</span>
          </div>
          <Switch
            aria-labelledby={evenOddLabelId}
            data-testid="docx-hf-even-odd"
            checked={state.evenAndOddHeaders}
            disabled={blocked}
            onCheckedChange={(next) => onSetEvenOdd(next === true)}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={editorId} className="text-label text-muted-foreground">
          {t("office.docx.headerFooter.textLabel", { slot: slotLabel })}
        </Label>
        <Textarea
          id={editorId}
          data-testid="docx-hf-text"
          rows={3}
          value={draft}
          disabled={blocked}
          placeholder={t("office.docx.headerFooter.placeholder")}
          onChange={(event) => setHeldDraft({ slot, base: currentText, text: event.target.value })}
        />
        <p className="text-caption text-muted-foreground">{t("office.docx.headerFooter.tokensHint")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" data-testid="docx-hf-apply" disabled={blocked || !dirty} onClick={apply}>
            {t("office.docx.headerFooter.apply")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="docx-hf-revert"
            disabled={blocked || !dirty}
            onClick={() => setHeldDraft(null)}
          >
            {t("office.docx.headerFooter.revert")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="docx-hf-clear"
            disabled={blocked || !hasHfSlotContent(slotState)}
            onClick={clear}
          >
            {t("office.docx.headerFooter.clear")}
          </Button>
        </div>
      </div>

      <div className="grid gap-1.5">
        <span className="text-label text-muted-foreground">{t("office.docx.headerFooter.preview")}</span>
        <div className="rounded-md border border-border bg-muted/40 p-3">
          {/* The strip styles are scoped to .docx-surface by the vendored sheet. */}
          <div className="docx-surface">
            {previewEmpty ? (
              <p className="text-caption text-muted-foreground" data-testid="docx-hf-preview-empty">
                {t("office.docx.headerFooter.previewEmpty")}
              </p>
            ) : (
              <DocxHeaderFooterPreview
                value={previewValue}
                kind={headerFooterKindOf(slot)}
                pageNo={pageNo}
                pageTotal={pageTotal}
                label={t("office.docx.headerFooter.previewLabel", { slot: slotLabel })}
              />
            )}
          </div>
          {slotState.hasImages ? (
            <p className="mt-1 text-caption text-muted-foreground">{t("office.docx.headerFooter.hasImages")}</p>
          ) : null}
        </div>
        {readOnly ? (
          <p className="text-caption text-muted-foreground" data-testid="docx-hf-readonly">
            {t("office.docx.headerFooter.readOnly")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
