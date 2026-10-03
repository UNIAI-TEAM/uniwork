"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { isValidLinkHref, type DocxLinkFormValue, type DocxLinkTarget } from "./link-commands";

export interface LinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The link being edited; prefills every field and offers Remove. A fresh insert passes null. */
  initial?: DocxLinkTarget | null;
  /** Selected text the insert prefills as display text; empty when the selection is a caret. */
  selectionText?: string;
  /** Read-only documents keep the fields visible but block Insert and Remove. */
  readOnly?: boolean;
  /** The caller applies the value and closes the dialog. */
  onSubmit: (value: DocxLinkFormValue) => void;
  onRemove: () => void;
}

/**
 * Insert/edit hyperlink dialog, Word-shaped: display text (prefilled from the
 * selection), address, optional ScreenTip; the address must be http(s) or
 * mailto. The caller owns the seed, so `initial` must keep its identity while
 * the dialog is open or typed edits would reset on every render.
 */
export function LinkDialog({
  open,
  onOpenChange,
  initial = null,
  selectionText = "",
  readOnly = false,
  onSubmit,
  onRemove,
}: LinkDialogProps) {
  const { t } = useTranslation();
  const textId = useId();
  const urlId = useId();
  const tooltipId = useId();
  const errorId = useId();
  const [href, setHref] = useState("");
  const [text, setText] = useState("");
  const [tooltip, setTooltip] = useState("");
  const editing = initial !== null;

  useEffect(() => {
    if (!open) return;
    setHref(initial?.href ?? "");
    setText(initial?.text ?? selectionText);
    setTooltip(initial?.tooltip ?? "");
  }, [open, initial, selectionText]);

  const valid = isValidLinkHref(href);
  const showError = href.trim().length > 0 && !valid;

  const submit = () => {
    if (!valid || readOnly) return;
    onSubmit({ href: href.trim(), text: text.trim(), tooltip: tooltip.trim() || null });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    // Enter submits from a text field; buttons keep their own activation.
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="docx-link-dialog" className="gap-3" closeLabel={t("common.close")} onKeyDown={onKeyDown}>
        <DialogHeader className="gap-1">
          <DialogTitle>{editing ? t("office.docx.links.edit") : t("office.docx.links.insertTitle")}</DialogTitle>
          <DialogDescription>{t("office.docx.links.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={textId}>{t("office.docx.links.text")}</Label>
            <Input id={textId} data-testid="docx-link-text" value={text} disabled={readOnly} onChange={(event) => setText(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={urlId}>{t("office.docx.links.url")}</Label>
            <Input
              id={urlId}
              data-testid="docx-link-url"
              value={href}
              disabled={readOnly}
              placeholder={t("office.docx.links.urlPlaceholder")}
              aria-invalid={showError || undefined}
              aria-describedby={showError ? errorId : undefined}
              onChange={(event) => setHref(event.target.value)}
            />
            {showError ? (
              <p id={errorId} role="alert" className="text-caption text-destructive">
                {t("office.docx.links.invalid")}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={tooltipId}>{t("office.docx.links.tooltip")}</Label>
            <Input id={tooltipId} data-testid="docx-link-tooltip" value={tooltip} disabled={readOnly} onChange={(event) => setTooltip(event.target.value)} />
          </div>
        </div>
        <DialogFooter className="flex-row items-center justify-end">
          {editing ? (
            <Button type="button" variant="destructive" className="mr-auto" disabled={readOnly} onClick={onRemove} data-testid="docx-link-remove">
              {t("office.docx.links.remove")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!valid || readOnly} onClick={submit} data-testid="docx-link-submit">
            {editing ? t("office.docx.links.apply") : t("office.docx.links.insert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
