"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import type {
  PdfFormField,
  PdfFormFieldKind,
  PdfFormFieldValueInput,
  PdfFormOperationProvider,
  PdfFormsPanelProps,
} from "./types";

type Translate = ReturnType<typeof useTranslation>["t"];

const KIND_LABEL_KEY: Record<PdfFormFieldKind, string> = {
  text: "office.pdf.forms.kind.text",
  checkbox: "office.pdf.forms.kind.checkbox",
  radio: "office.pdf.forms.kind.radio",
  choice: "office.pdf.forms.kind.choice",
};

function fieldLabel(field: PdfFormField): string {
  const label = field.label?.trim();
  return label && label !== "" ? label : field.name;
}

function optionLabel(option: { value: string; label?: string }): string {
  return option.label?.trim() || option.value;
}

function currentText(field: PdfFormField): string {
  return typeof field.value === "string" ? field.value : "";
}

function currentChecked(field: PdfFormField): boolean {
  return field.value === true;
}

function kindLabel(t: Translate, kind: PdfFormFieldKind): string {
  return t(KIND_LABEL_KEY[kind]);
}

/** One field's controls. A text field commits on blur or Enter so no keystroke
 * becomes an engine write; every other kind commits on the change. */
function PdfFormFieldRow({
  field,
  index,
  provider,
  busy,
  readOnly,
  onBusy,
  onFailure,
  onApplied,
}: {
  field: PdfFormField;
  index: number;
  provider?: PdfFormOperationProvider;
  busy: boolean;
  readOnly: boolean;
  onBusy: (busy: boolean) => void;
  onFailure: () => void;
  onApplied?: () => void;
}) {
  const { t } = useTranslation();
  const value = field.value;
  const [draft, setDraft] = useState(() => currentText(field));
  const [checked, setChecked] = useState(() => currentChecked(field));
  const id = `pdf-form-field-${index}`;
  const labelId = `${id}-label`;
  const label = fieldLabel(field);
  const hasOptions = field.options !== undefined && field.options.length > 0;

  // The host owns the document: when it re-reads the fields after an apply, the
  // controls follow the new truth instead of a draft a user typed earlier.
  // Depending on the value, not the row object, keeps a parent re-render that
  // rebuilds the array from wiping what the user is typing.
  useEffect(() => {
    setDraft(typeof value === "string" ? value : "");
    setChecked(value === true);
  }, [value]);

  const locked = readOnly || busy || field.readOnly === true || provider === undefined;

  const submit = async (input: PdfFormFieldValueInput) => {
    if (locked || !provider) return;
    onBusy(true);
    try {
      await provider.setFormValue(input);
      onApplied?.();
    } catch {
      onFailure();
      setDraft(currentText(field));
      setChecked(currentChecked(field));
    } finally {
      onBusy(false);
    }
  };

  const commitText = () => {
    if (locked || draft === currentText(field)) return;
    void submit({ name: field.name, kind: "text", value: draft });
  };

  return (
    <li className="grid gap-1.5 rounded-md border border-border px-2 py-2" data-testid={`pdf-form-field-${field.name}`}>
      <div className="grid gap-0.5">
        {/* Only the text input is a labelable element, so it binds through
            htmlFor/id; the radio group is a div and takes the label's id
            through aria-labelledby, and the span-based primitives carry the
            same text as their own aria-label. */}
        {field.kind === "radio" && hasOptions ? (
          <span id={labelId} className="text-body font-medium">{label}</span>
        ) : (
          <Label htmlFor={id} className="text-body font-medium">{label}</Label>
        )}
        <span className="text-caption text-muted-foreground">{kindLabel(t, field.kind)}</span>
      </div>
      {field.kind === "text" ? (
        <Input
          id={id}
          value={draft}
          disabled={locked}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitText();
            }
          }}
        />
      ) : null}
      {field.kind === "checkbox" ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            aria-label={label}
            checked={checked}
            disabled={locked}
            onCheckedChange={(next) => {
              const value = next === true;
              setChecked(value);
              void submit({ name: field.name, kind: "checkbox", value });
            }}
          />
          <span className="text-caption text-muted-foreground">
            {checked ? t("office.pdf.forms.checked") : t("office.pdf.forms.unchecked")}
          </span>
        </div>
      ) : null}
      {field.kind === "radio" && hasOptions ? (
        <RadioGroup
          aria-labelledby={labelId}
          value={currentText(field)}
          disabled={locked}
          className="gap-1.5"
          onValueChange={(value) => {
            if (typeof value !== "string" || value === currentText(field)) return;
            void submit({ name: field.name, kind: "radio", value });
          }}
        >
          {field.options?.map((option, optionIndex) => {
            const optionId = `${id}-option-${optionIndex}`;
            return (
              <div key={option.value} className="flex items-center gap-2">
                <RadioGroupItem value={option.value} id={optionId} aria-label={optionLabel(option)} disabled={locked} />
                <Label htmlFor={optionId} className="font-normal">{optionLabel(option)}</Label>
              </div>
            );
          })}
        </RadioGroup>
      ) : null}
      {/* A radio the host reported without options is still a two-state field;
          it is offered as a boolean toggle, the shape the engine takes for a
          checkbox, rather than an empty group. */}
      {field.kind === "radio" && !hasOptions ? (
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            size="sm"
            aria-label={label}
            checked={checked}
            disabled={locked}
            onCheckedChange={(value) => {
              setChecked(value);
              void submit({ name: field.name, kind: "radio", value });
            }}
          />
          <span className="text-caption text-muted-foreground">
            {checked ? t("office.pdf.forms.selected") : t("office.pdf.forms.notSelected")}
          </span>
        </div>
      ) : null}
      {field.kind === "choice" && hasOptions ? (
        <Select
          id={id}
          aria-label={label}
          value={currentText(field)}
          disabled={locked}
          items={field.options?.map((option) => ({ value: option.value, label: optionLabel(option) })) ?? []}
          onValueChange={(value) => {
            if (typeof value !== "string" || value === currentText(field)) return;
            void submit({ name: field.name, kind: "choice", value });
          }}
        />
      ) : null}
      {field.kind === "choice" && !hasOptions ? (
        <p className="text-caption text-muted-foreground">{t("office.pdf.forms.noOptions")}</p>
      ) : null}
      {field.readOnly === true ? <p className="text-caption text-muted-foreground">{t("office.pdf.forms.fieldReadOnly")}</p> : null}
    </li>
  );
}

/**
 * Lists the document's AcroForm fields and fills them through the browser-safe
 * provider: a text edit commits when it leaves the field, a toggle or a pick
 * commits on the change. Flattening is a one-way engine step, so the toggle
 * latches on once it succeeds instead of pretending it can be switched back off.
 */
export function PdfFormsPanel({
  fields,
  provider,
  loading = false,
  error = null,
  disabled = false,
  readOnly = false,
  className,
  onApplied,
}: PdfFormsPanelProps) {
  const { t } = useTranslation();
  const [busyField, setBusyField] = useState<string | null>(null);
  const [failedField, setFailedField] = useState<string | null>(null);
  const [flattenState, setFlattenState] = useState<"idle" | "pending" | "applied">("idle");
  const [flattenFailed, setFlattenFailed] = useState(false);

  const list = fields ?? [];
  const locked = disabled || readOnly || provider === undefined;

  const flatten = async () => {
    if (!provider || flattenState !== "idle" || locked) return;
    setFlattenState("pending");
    setFlattenFailed(false);
    try {
      await provider.flattenForms();
      setFlattenState("applied");
      onApplied?.();
    } catch {
      setFlattenState("idle");
      setFlattenFailed(true);
    }
  };

  return (
    <section className={cn("grid gap-2", className)} data-testid="pdf-forms-panel" aria-label={t("office.pdf.forms.title")}>
      <h2 className="text-label font-medium">{t("office.pdf.forms.title")}</h2>
      {error !== null ? <p role="alert" className="text-caption text-destructive">{error === "" ? t("office.pdf.forms.error") : error}</p> : null}
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground" data-testid="pdf-forms-loading">
          <Spinner aria-hidden className="size-3.5" />
          {t("office.pdf.forms.loading")}
        </p>
      ) : null}
      {!loading && error === null && list.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("office.pdf.forms.empty")}</p>
      ) : null}
      {!loading && list.length > 0 ? (
        <ul className="grid gap-1.5" aria-label={t("office.pdf.forms.title")}>
          {list.map((field, index) => (
            <PdfFormFieldRow
              key={`${index}-${field.name}`}
              field={field}
              index={index}
              provider={provider}
              busy={busyField === field.name}
              readOnly={locked}
              onBusy={(next) => {
                setBusyField(next ? field.name : null);
                if (next) setFailedField(null);
              }}
              onFailure={() => setFailedField(field.name)}
              onApplied={onApplied}
            />
          ))}
        </ul>
      ) : null}
      {!loading && list.length > 0 && provider !== undefined ? (
        <div className="grid gap-1 border-t border-border pt-2">
          <div className="flex items-center gap-2">
            <Switch
              id="pdf-forms-flatten"
              size="sm"
              aria-label={t("office.pdf.forms.flatten")}
              checked={flattenState !== "idle"}
              disabled={locked || flattenState !== "idle"}
              aria-busy={flattenState === "pending" || undefined}
              onCheckedChange={(value) => {
                if (value) void flatten();
              }}
            />
            <Label htmlFor="pdf-forms-flatten">{t("office.pdf.forms.flatten")}</Label>
          </div>
          <p className="text-caption text-muted-foreground">{t("office.pdf.forms.flattenHint")}</p>
          {flattenState === "pending" ? <p role="status" className="text-caption text-muted-foreground">{t("office.pdf.forms.flattenPending")}</p> : null}
          {flattenState === "applied" ? <p role="status" className="text-caption text-muted-foreground">{t("office.pdf.forms.flattenApplied")}</p> : null}
          {flattenFailed ? <p role="alert" className="text-caption text-destructive">{t("office.pdf.forms.flattenError")}</p> : null}
        </div>
      ) : null}
      {locked && provider === undefined && list.length > 0 ? (
        <p className="text-caption text-muted-foreground">{t("office.pdf.forms.readOnly")}</p>
      ) : null}
      {failedField !== null ? (
        <p role="alert" className="text-caption text-destructive">{t("office.pdf.forms.applyError")}</p>
      ) : null}
    </section>
  );
}
