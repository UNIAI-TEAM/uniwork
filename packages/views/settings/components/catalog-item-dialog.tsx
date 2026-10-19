"use client";

import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { CatalogColorField, isHexColor } from "./catalog-color-field";
import { SettingsFieldError } from "./settings-layout";

export interface CatalogDraft {
  name: string;
  description: string;
  color: string;
  /** Statuses only: the category the status counts as. */
  category?: string;
  /** Statuses only: the category whose glyph it draws, "" for its own. */
  icon?: string;
}

/** A field the caller adds to the form, reading and patching the draft. */
type DraftSlot = (draft: CatalogDraft, patch: (next: Partial<CatalogDraft>) => void) => ReactNode;

/** What a save came to; a failure other than a taken name is the caller's to report. */
export type CatalogSaveResult = "saved" | "conflict" | "failed";

// Server limits: task_catalog.go (statuses) and task_catalog_labels.go (labels).
const NAME_MAX = 64;
const DESCRIPTION_MAX = 256;

/**
 * Create or edit one entry of the task catalog — a custom status or a label.
 * Both are a name, a description and a colour, so they share this form; the
 * caller decides what saving means.
 */
export function CatalogItemDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  submitLabel,
  onSubmit,
  afterName,
  afterColor,
  colorPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initial: CatalogDraft;
  submitLabel: string;
  onSubmit: (draft: CatalogDraft) => Promise<CatalogSaveResult>;
  /** Fields between the name and the description (a status's group). */
  afterName?: DraftSlot;
  /** Fields after the colour (a status's icon). */
  afterColor?: DraftSlot;
  /** What the colour trigger shows in the colour, a dot by default. */
  colorPreview?: (draft: CatalogDraft, hex?: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [nameMissing, setNameMissing] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const descriptionId = useId();
  const nameErrorId = `${nameId}-error`;

  // Reset only on open: a refetch while the dialog is open must not eat what
  // the user is typing.
  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setNameMissing(false);
    setNameTaken(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is read on open only
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const name = draft.name.trim();
    if (!name) {
      setNameMissing(true);
      return;
    }
    if (!isHexColor(draft.color)) return;
    setSaving(true);
    const result = await onSubmit({ ...draft, name, description: draft.description.trim(), color: draft.color.trim() });
    setSaving(false);
    if (result === "saved") onOpenChange(false);
    else if (result === "conflict") setNameTaken(true);
  };

  const patch = (next: Partial<CatalogDraft>) => setDraft((current) => ({ ...current, ...next }));

  const nameError = nameMissing
    ? t("settings.catalogItem.name_required")
    : nameTaken
      ? t("settings.catalogItem.name_taken")
      : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <FormDialogContent showCloseButton={!saving}>
        <form onSubmit={(e) => void submit(e)} noValidate>
          <FormDialogHeader title={title} description={description} />
          <FormDialogBody>
            <Field>
              <FieldLabel htmlFor={nameId}>{t("settings.catalogItem.name")}</FieldLabel>
              <Input
                id={nameId}
                value={draft.name}
                maxLength={NAME_MAX}
                autoComplete="off"
                readOnly={saving}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? nameErrorId : undefined}
                onChange={(e) => {
                  setDraft({ ...draft, name: e.target.value });
                  setNameMissing(false);
                  setNameTaken(false);
                }}
              />
              {nameError ? <SettingsFieldError id={nameErrorId}>{nameError}</SettingsFieldError> : null}
            </Field>
            {afterName?.(draft, patch)}
            <Field>
              <FieldLabel htmlFor={descriptionId}>{t("settings.catalogItem.description")}</FieldLabel>
              <Textarea
                id={descriptionId}
                value={draft.description}
                maxLength={DESCRIPTION_MAX}
                rows={2}
                readOnly={saving}
                placeholder={t("settings.catalogItem.description_placeholder")}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
            <CatalogColorField
              value={draft.color}
              onChange={(color) => patch({ color })}
              preview={colorPreview ? (hex) => colorPreview(draft, hex) : undefined}
            />
            {afterColor?.(draft, patch)}
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => onOpenChange(false)}
            submitType="submit"
            submitLabel={submitLabel}
            submittingLabel={t("settings.catalogItem.saving")}
            submitting={saving}
            submitDisabled={!isHexColor(draft.color)}
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
