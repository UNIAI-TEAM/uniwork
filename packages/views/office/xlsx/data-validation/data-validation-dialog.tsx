"use client";

// Data Validation rules dialog (XLSX Data tab). One rule over the selection:
// Allow (list / whole / decimal / date), the source or operator + values, and an
// optional Stop error message. Apply builds the pinned rule through
// dv-commands and fires `sheet.command.addDataValidation` on the toolbar's one
// command port; the save/journal path is owned elsewhere.

import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import type { XlsxToolbarCommands } from "../toolbar/types";
import {
  addDvParams,
  buildDvRule,
  isTwoValueOperator,
  XLSX_DV_ADD_COMMAND,
  updateDvCommands,
  XLSX_DV_EMPTY_FORM,
  XLSX_DV_ERROR_STYLES,
  XLSX_DV_ERROR_MAX_CHARS,
  XLSX_DV_OPERATORS,
  XLSX_DV_TITLE_MAX_CHARS,
  XLSX_DV_TYPES,
  type XlsxDvErrorStyle,
  type XlsxDvFailure,
  type XlsxDvForm,
  type XlsxDvOperator,
  type XlsxDvRange,
  type XlsxDvType,
} from "./dv-commands";
import { rangesLabel } from "./rule-areas";
import { runRuleCommand, runRuleCommandsAtomically } from "./run-rule-command";

export interface XlsxDataValidationDialogProps {
  commands: XlsxToolbarCommands;
  unitId: string;
  subUnitId: string;
  range: XlsxDvRange;
  /** The sheet holds Excel extended (x14) validation the save cannot rewrite:
   *  the dialog explains it and Apply stays inert. */
  blocked?: boolean;
  /** Edit mode (rule manager): the dialog opens with the rule's form and Apply
   *  updates live rule `rule` (id `ruleId`) in place, all or nothing, with
   *  only the setting / options that changed. */
  edit?: { ruleId: string; ranges: readonly XlsxDvRange[]; form: XlsxDvForm; rule: Readonly<Record<string, unknown>> };
  onClose: () => void;
}

const isDvType = (value: unknown): value is XlsxDvType => XLSX_DV_TYPES.some((type) => type === value);
const isDvOperator = (value: unknown): value is XlsxDvOperator => XLSX_DV_OPERATORS.some((operator) => operator === value);

const isErrorStyle = (value: unknown): value is XlsxDvErrorStyle => XLSX_DV_ERROR_STYLES.some((style) => style === value);

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-caption font-medium">
        {label}
      </Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p role="alert" id={`${id}-error`} className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function XlsxDataValidationDialog({ commands, unitId, subUnitId, range, blocked = false, edit, onClose }: XlsxDataValidationDialogProps) {
  const { t } = useTranslation();
  const base = useId();
  const [form, setForm] = useState<XlsxDvForm>(edit?.form ?? XLSX_DV_EMPTY_FORM);
  const [failure, setFailure] = useState<XlsxDvFailure | null>(null);
  const [refused, setRefused] = useState(false);
  const [pending, setPending] = useState(false);
  const patch = (next: Partial<XlsxDvForm>) => {
    setFailure(null);
    setRefused(false);
    setForm((current) => ({ ...current, ...next }));
  };
  const isList = form.type === "list";
  const two = !isList && isTwoValueOperator(form.operator);
  const valueInputType = form.type === "date" ? "date" : "text";
  const errorFor = (field: XlsxDvFailure["field"]): string | undefined =>
    failure?.field === field ? t(`office.xlsx.dataValidation.errors.${failure.code}`) : undefined;
  const invalid = (field: XlsxDvFailure["field"]) => (failure?.field === field ? true : undefined);
  const describedBy = (id: string, field: XlsxDvFailure["field"], hint = false) =>
    [hint ? `${id}-hint` : null, failure?.field === field ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  const apply = async () => {
    if (blocked || pending) return;
    const built = buildDvRule(form, range);
    if (!built.ok) {
      setFailure(built.failure);
      return;
    }
    setPending(true);
    let accepted: boolean;
    if (edit) {
      accepted = await runRuleCommandsAtomically(commands, updateDvCommands(unitId, subUnitId, edit.ruleId, built.rule, edit.rule));
    } else {
      accepted = await runRuleCommand(commands, XLSX_DV_ADD_COMMAND, addDvParams(unitId, subUnitId, built.rule));
    }
    setPending(false);
    if (accepted) onClose();
    else setRefused(true);
  };

  const typeId = `${base}-type`;
  const operatorId = `${base}-operator`;
  const value1Id = `${base}-value1`;
  const value2Id = `${base}-value2`;
  const styleId = `${base}-style`;
  const titleId = `${base}-title`;
  const messageId = `${base}-message`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="xlsx-dv-dialog" closeLabel={t("office.xlsx.dataValidation.dialog.close")}>
        <DialogHeader>
          <DialogTitle>{t("office.xlsx.dataValidation.dialog.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void apply();
          }}
        >
          <p className="text-caption text-muted-foreground" data-testid="xlsx-dv-range">
            {t("office.xlsx.dataValidation.dialog.range")}: <span className="font-medium text-foreground">{rangesLabel(edit?.ranges ?? [range])}</span>
          </p>
          <Field id={typeId} label={t("office.xlsx.dataValidation.dialog.allow")}>
            <Select
              id={typeId}
              aria-label={t("office.xlsx.dataValidation.dialog.allow")}
              triggerVariant="subtle"
              value={form.type}
              onValueChange={(value) => {
                if (isDvType(value)) patch({ type: value, value1: "", value2: "" });
              }}
              items={XLSX_DV_TYPES.map((type) => ({ value: type, label: t(`office.xlsx.dataValidation.types.${type}`) }))}
            />
          </Field>
          {isList ? (
            <Field
              id={value1Id}
              label={t("office.xlsx.dataValidation.dialog.source")}
              hint={t("office.xlsx.dataValidation.dialog.sourceHint")}
              error={errorFor("value1")}
            >
              <Input
                id={value1Id}
                value={form.value1}
                aria-invalid={invalid("value1")}
                aria-describedby={describedBy(value1Id, "value1", true)}
                data-testid="xlsx-dv-source"
                onChange={(event) => patch({ value1: event.target.value })}
              />
            </Field>
          ) : (
            <>
              <Field id={operatorId} label={t("office.xlsx.dataValidation.dialog.operator")}>
                <Select
                  id={operatorId}
                  aria-label={t("office.xlsx.dataValidation.dialog.operator")}
                  triggerVariant="subtle"
                  value={form.operator}
                  onValueChange={(value) => {
                    if (isDvOperator(value)) patch({ operator: value });
                  }}
                  items={XLSX_DV_OPERATORS.map((operator) => ({
                    value: operator,
                    label: t(`office.xlsx.dataValidation.operators.${operator}`),
                  }))}
                />
              </Field>
              <Field
                id={value1Id}
                label={t(two ? "office.xlsx.dataValidation.dialog.minimum" : "office.xlsx.dataValidation.dialog.value")}
                error={errorFor("value1")}
              >
                <Input
                  id={value1Id}
                  type={valueInputType}
                  inputMode={form.type === "date" ? undefined : "decimal"}
                  value={form.value1}
                  aria-invalid={invalid("value1")}
                  aria-describedby={describedBy(value1Id, "value1")}
                  data-testid="xlsx-dv-value1"
                  onChange={(event) => patch({ value1: event.target.value })}
                />
              </Field>
              {two ? (
                <Field id={value2Id} label={t("office.xlsx.dataValidation.dialog.maximum")} error={errorFor("value2")}>
                  <Input
                    id={value2Id}
                    type={valueInputType}
                    inputMode={form.type === "date" ? undefined : "decimal"}
                    value={form.value2}
                    aria-invalid={invalid("value2")}
                    aria-describedby={describedBy(value2Id, "value2")}
                    data-testid="xlsx-dv-value2"
                    onChange={(event) => patch({ value2: event.target.value })}
                  />
                </Field>
              ) : null}
            </>
          )}
          <fieldset className="grid gap-2 rounded-control border border-border p-2">
            <legend className="px-1 text-caption font-medium">{t("office.xlsx.dataValidation.dialog.errorSection")}</legend>
            <Field
              id={styleId}
              label={t("office.xlsx.dataValidation.dialog.errorStyle")}
              hint={t(`office.xlsx.dataValidation.errorStyleHints.${form.errorStyle}`)}
            >
              <Select
                id={styleId}
                aria-label={t("office.xlsx.dataValidation.dialog.errorStyle")}
                aria-describedby={`${styleId}-hint`}
                triggerVariant="subtle"
                value={form.errorStyle}
                onValueChange={(value) => {
                  if (isErrorStyle(value)) patch({ errorStyle: value });
                }}
                items={XLSX_DV_ERROR_STYLES.map((style) => ({ value: style, label: t(`office.xlsx.dataValidation.errorStyles.${style}`) }))}
              />
            </Field>
            <Field id={titleId} label={t("office.xlsx.dataValidation.dialog.errorTitle")} error={errorFor("errorTitle")}>
              <Input
                id={titleId}
                value={form.errorTitle}
                maxLength={XLSX_DV_TITLE_MAX_CHARS * 2}
                aria-invalid={invalid("errorTitle")}
                aria-describedby={describedBy(titleId, "errorTitle")}
                data-testid="xlsx-dv-error-title"
                onChange={(event) => patch({ errorTitle: event.target.value })}
              />
            </Field>
            <Field id={messageId} label={t("office.xlsx.dataValidation.dialog.errorMessage")} error={errorFor("error")}>
              <Input
                id={messageId}
                value={form.error}
                maxLength={XLSX_DV_ERROR_MAX_CHARS * 2}
                aria-invalid={invalid("error")}
                aria-describedby={describedBy(messageId, "error")}
                data-testid="xlsx-dv-error-message"
                onChange={(event) => patch({ error: event.target.value })}
              />
            </Field>
          </fieldset>
          {blocked ? (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-dv-x14">
              {t("office.xlsx.dataValidation.errors.x14Sheet")}
            </p>
          ) : null}
          {refused ? (
            <p role="alert" className="text-caption text-destructive" data-testid="xlsx-dv-refused">
              {t("office.xlsx.dataValidation.errors.refused")}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" data-testid="xlsx-dv-cancel" onClick={onClose}>
              {t("office.xlsx.dataValidation.dialog.cancel")}
            </Button>
            <Button type="submit" size="sm" aria-disabled={blocked || pending || undefined} data-testid="xlsx-dv-apply">
              {t("office.xlsx.dataValidation.dialog.apply")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
