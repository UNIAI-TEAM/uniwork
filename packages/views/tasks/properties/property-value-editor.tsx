"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { TaskProperty } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../common/date-field";
import { PropertyValueDisplay } from "./property-value-display";
import { readPropertyValue } from "./property-value";
import { PropertyMultiSelectEditor, PropertySelectEditor } from "./property-select-editor";

export type PropertyValueEditorProps = {
  property: TaskProperty;
  value: unknown;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (value: unknown) => void;
  onClear: () => void;
  ariaLabel: string;
  triggerClassName?: string;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
};

/**
 * Click-to-edit trigger for `text`/`url`/`number`: shows `PropertyValueDisplay`
 * until clicked, then swaps in an `Input`. Enter or blur commits the trimmed
 * draft (empty commits as `onClear`); Escape reverts without calling either
 * callback. Validity for url/number is `readPropertyValue` itself — a draft
 * that fails to parse for the property's type shows the matching
 * `tasks.properties.invalid_*` message instead of committing (text can never
 * fail: any non-empty string is a valid text value).
 */
function PropertyInlineEditor({
  property,
  value,
  disabled,
  disabledReason,
  onChange,
  onClear,
  ariaLabel,
  triggerClassName,
  onTriggerNavigationGuard,
}: PropertyValueEditorProps) {
  const { t } = useTranslation();
  const typed = readPropertyValue(property, value);
  const stored = typeof typed === "string" ? typed : typeof typed === "number" ? String(typed) : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stored);
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(stored);
      setError(undefined);
    }
  }, [editing, stored]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const invalidKey =
    property.type === "url"
      ? "tasks.properties.invalid_url"
      : property.type === "number"
        ? "tasks.properties.invalid_number"
        : undefined;

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setEditing(false);
      setError(undefined);
      if (typed !== undefined) onClear();
      return;
    }
    const next = readPropertyValue(property, trimmed);
    if (next === undefined) {
      if (invalidKey) setError(t(invalidKey));
      return;
    }
    setEditing(false);
    setError(undefined);
    if (next === typed) return;
    onChange(next);
  };

  if (editing && !disabled) {
    return (
      <div className={cn("flex flex-col gap-1", triggerClassName)}>
        <Input
          ref={inputRef}
          value={draft}
          type="text"
          inputMode={property.type === "number" ? "decimal" : undefined}
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setDraft(stored);
              setError(undefined);
              setEditing(false);
            }
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
          className="h-7"
        />
        {error ? <p className="text-caption text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={triggerClassName}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      title={disabled ? disabledReason : undefined}
      onPointerDown={onTriggerNavigationGuard}
      onClick={(event) => {
        onTriggerNavigationGuard?.(event);
        if (!disabled) setEditing(true);
      }}
      onAuxClick={onTriggerNavigationGuard}
    >
      <PropertyValueDisplay property={property} value={value} />
    </Button>
  );
}

/** Row-nav guard wraps the field itself (matches `TableDueDateCell` in
 * `table-cell-editors.tsx`) since `DateField` has no navigation-guard prop of
 * its own. The accessible name comes from an associated `<label>` rather
 * than an `aria-label` prop, again because `DateField` takes neither —
 * mirrors `CreateTaskCustomProperties`' `<Label htmlFor={id}>`, just
 * visually hidden since this trigger is compact like the other pickers. */
function PropertyDateEditor({
  property,
  value,
  disabled,
  onChange,
  onClear,
  ariaLabel,
  triggerClassName,
  onTriggerNavigationGuard,
}: PropertyValueEditorProps) {
  const id = `property-date-${property.id}`;
  const stored = (readPropertyValue(property, value) as string | undefined) ?? "";
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stops row nav; child control is interactive
    <div onClick={onTriggerNavigationGuard} onAuxClick={onTriggerNavigationGuard}>
      <label htmlFor={id} className="sr-only">
        {ariaLabel}
      </label>
      <DateField
        id={id}
        value={stored}
        onChange={(next) => {
          if (next) onChange(next);
          else onClear();
        }}
        disabled={disabled}
        className={triggerClassName}
      />
    </div>
  );
}

function PropertyCheckboxEditor({
  property,
  value,
  disabled,
  disabledReason,
  onChange,
  ariaLabel,
  onTriggerNavigationGuard,
}: PropertyValueEditorProps) {
  const checked = readPropertyValue(property, value) === true;
  return (
    <Checkbox
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      title={disabled ? disabledReason : undefined}
      onPointerDown={onTriggerNavigationGuard}
      onClick={onTriggerNavigationGuard}
      onCheckedChange={(next) => onChange(next === true)}
    />
  );
}

/** Archived property: display only, plus a clear action so a stale value can
 * still be removed from the task — no picker, no inline input, nothing that
 * would let the archived catalog entry gain a new value. */
function ArchivedPropertyValue({
  property,
  value,
  disabled,
  disabledReason,
  onClear,
  triggerClassName,
  onTriggerNavigationGuard,
}: PropertyValueEditorProps) {
  const { t } = useTranslation();
  const hasValue = readPropertyValue(property, value) !== undefined;
  return (
    <div className={cn("flex min-w-0 items-center gap-1", triggerClassName)}>
      <PropertyValueDisplay property={property} value={value} className="min-w-0 flex-1" />
      {hasValue ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 shrink-0"
          aria-disabled={disabled || undefined}
          aria-label={t("tasks.properties.clear")}
          title={disabled ? disabledReason : undefined}
          onPointerDown={onTriggerNavigationGuard}
          onClick={(event) => {
            onTriggerNavigationGuard?.(event);
            if (disabled) return;
            onClear();
          }}
        >
          <X className="size-3" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Shared editor for a task's custom property value, dispatching on
 * `property.type`. An archived property (`archived_at` set) never renders an
 * editing control regardless of type — only `PropertyValueDisplay` plus a
 * clear action.
 */
export function PropertyValueEditor(props: PropertyValueEditorProps) {
  const { property } = props;

  if (property.archived_at) {
    return <ArchivedPropertyValue {...props} />;
  }

  switch (property.type) {
    case "checkbox":
      return <PropertyCheckboxEditor {...props} />;
    case "select":
      return <PropertySelectEditor {...props} />;
    case "multi_select":
      return <PropertyMultiSelectEditor {...props} />;
    case "date":
      return <PropertyDateEditor {...props} />;
    case "number":
    case "url":
    case "text":
    default:
      return <PropertyInlineEditor {...props} />;
  }
}
