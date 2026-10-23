"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TaskProperty } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { DateField } from "../common/date-field";
import { PillButton } from "../common/pill-button";
import { PropertyIcon } from "./icons/property-icon";
import { PickerItem, PropertyPicker } from "./pickers/property-picker";

type PropertyOption = { value: string; label: string; color?: string };

export function isValidPropertyDraft(type: string, draft: string): boolean {
  const trimmed = draft.trim();
  if (trimmed === "") return true;
  if (type === "number") return Number.isFinite(Number(trimmed));
  if (type !== "url") return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function optionsFor(property: TaskProperty): PropertyOption[] {
  const raw = property.config?.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((option): PropertyOption[] => {
    if (typeof option === "string") return [{ value: option, label: option }];
    if (!option || typeof option !== "object") return [];
    const record = option as Record<string, unknown>;
    const value = record.value ?? record.id ?? record.name;
    const label = record.label ?? record.name ?? value;
    return typeof value === "string" && typeof label === "string"
      ? [{ value, label, color: typeof record.color === "string" ? record.color : undefined }]
      : [];
  });
}

function PropertyTrigger({
  property,
  valueLabel,
}: {
  property: TaskProperty;
  valueLabel?: string;
}) {
  return (
    <>
      <PropertyIcon property={property} className="size-3.5 text-muted-foreground" />
      <span className="max-w-32 truncate">{property.name}</span>
      {valueLabel ? (
        <span className="max-w-40 truncate text-muted-foreground">{valueLabel}</span>
      ) : null}
    </>
  );
}

function SelectPropertyField({
  property,
  value,
  multiple,
  open,
  onOpenChange,
  onChange,
}: {
  property: TaskProperty;
  value: unknown;
  multiple: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: unknown | undefined) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const options = useMemo(() => optionsFor(property), [property]);
  const selected = useMemo(
    () =>
      new Set(
        multiple
          ? Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : []
          : typeof value === "string"
            ? [value]
            : [],
      ),
    [multiple, value],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalized))
      : options;
  }, [options, query]);
  const selectedLabels = options
    .filter((option) => selected.has(option.value))
    .map((option) => option.label)
    .join(", ");

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      align="start"
      width="w-56"
      searchable={options.length > 7}
      searchPlaceholder={t("tasks.create.property_search_placeholder", { name: property.name })}
      searchAriaLabel={t("tasks.create.property_search_placeholder", { name: property.name })}
      onSearchChange={setQuery}
      triggerRender={<PillButton aria-label={property.name} />}
      trigger={<PropertyTrigger property={property} valueLabel={selectedLabels || undefined} />}
    >
      <PickerItem
        emptyValue
        selected={selected.size === 0}
        onClick={() => {
          onChange(undefined);
          onOpenChange(false);
        }}
      >
        <span className="text-muted-foreground">{t("tasks.table.empty_value")}</span>
      </PickerItem>
      {filtered.map((option) => (
        <PickerItem
          key={option.value}
          selected={selected.has(option.value)}
          onClick={() => {
            if (!multiple) {
              onChange(option.value);
              onOpenChange(false);
              return;
            }
            const next = new Set(selected);
            if (next.has(option.value)) next.delete(option.value);
            else next.add(option.value);
            onChange(next.size > 0 ? [...next] : undefined);
          }}
        >
          {option.color ? (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: option.color }}
              aria-hidden
            />
          ) : null}
          <span className="truncate">{option.label}</span>
        </PickerItem>
      ))}
      {filtered.length === 0 ? (
        <p className="px-2 py-3 text-center text-body text-muted-foreground">
          {t("tasks.create.options_no_results")}
        </p>
      ) : null}
    </PropertyPicker>
  );
}

function CheckboxPropertyField({
  property,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  property: TaskProperty;
  value: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: unknown | undefined) => void;
}) {
  const { t } = useTranslation();
  const valueLabel =
    value === true
      ? t("tasks.create.property_true")
      : value === false
        ? t("tasks.create.property_false")
        : undefined;

  return (
    <PropertyPicker
      open={open}
      onOpenChange={onOpenChange}
      align="start"
      width="w-44"
      triggerRender={<PillButton aria-label={property.name} />}
      trigger={<PropertyTrigger property={property} valueLabel={valueLabel} />}
    >
      <PickerItem
        emptyValue
        selected={value === undefined}
        onClick={() => {
          onChange(undefined);
          onOpenChange(false);
        }}
      >
        <span className="text-muted-foreground">{t("tasks.table.empty_value")}</span>
      </PickerItem>
      {([true, false] as const).map((option) => (
        <PickerItem
          key={String(option)}
          selected={value === option}
          onClick={() => {
            onChange(option);
            onOpenChange(false);
          }}
        >
          {option ? t("tasks.create.property_true") : t("tasks.create.property_false")}
        </PickerItem>
      ))}
    </PropertyPicker>
  );
}

function TextPropertyField({
  property,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  property: TaskProperty;
  value: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: unknown | undefined) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const current = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const inputType = property.type === "number" ? "number" : property.type === "url" ? "url" : "text";
  const trimmedDraft = draft.trim();
  const draftIsValid = isValidPropertyDraft(property.type, draft);

  const commit = () => {
    if (!draftIsValid) return;
    onChange(
      trimmedDraft === ""
        ? undefined
        : property.type === "number"
          ? Number(trimmedDraft)
          : trimmedDraft,
    );
    onOpenChange(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(current);
        onOpenChange(next);
      }}
    >
      <PopoverTrigger render={<PillButton aria-label={property.name} />}>
        <PropertyTrigger property={property} valueLabel={current || undefined} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="space-y-2">
          <Input
            name={`task-property-${property.id}`}
            type={inputType}
            inputMode={property.type === "number" ? "decimal" : undefined}
            autoComplete="off"
            aria-label={property.name}
            aria-invalid={!draftIsValid}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            {current ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange(undefined);
                  onOpenChange(false);
                }}
              >
                {t("common.delete")}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={!draftIsValid} onClick={commit}>{t("common.save")}</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CustomPropertyField({
  property,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  property: TaskProperty;
  value: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: unknown | undefined) => void;
}) {
  if (property.type === "select" || property.type === "multi_select") {
    return (
      <SelectPropertyField
        property={property}
        value={value}
        multiple={property.type === "multi_select"}
        open={open}
        onOpenChange={onOpenChange}
        onChange={onChange}
      />
    );
  }
  if (property.type === "checkbox") {
    return (
      <CheckboxPropertyField
        property={property}
        value={value}
        open={open}
        onOpenChange={onOpenChange}
        onChange={onChange}
      />
    );
  }
  if (property.type === "date") {
    return (
      <DateField
        value={typeof value === "string" ? value : ""}
        onChange={(next) => onChange(next || undefined)}
        modal={false}
        ariaLabel={property.name}
        placeholder={property.name}
        formatOptions={{ day: "numeric", month: "short" }}
        triggerRender={<PillButton />}
        open={open}
        onOpenChange={onOpenChange}
        renderTrigger={(label, selected) => (
          <PropertyTrigger property={property} valueLabel={selected ? label : undefined} />
        )}
      />
    );
  }
  return (
    <TextPropertyField
      property={property}
      value={value}
      open={open}
      onOpenChange={onOpenChange}
      onChange={onChange}
    />
  );
}

export function CreateTaskCustomProperties({
  properties,
  values,
  activePropertyId,
  onActivePropertyChange,
  onChange,
}: {
  properties: TaskProperty[];
  values: Record<string, unknown>;
  activePropertyId?: string;
  onActivePropertyChange?: (propertyId: string | undefined) => void;
  onChange: (propertyId: string, value: unknown | undefined) => void;
}) {
  const [internalActivePropertyId, setInternalActivePropertyId] = useState<string>();
  const controlled = onActivePropertyChange !== undefined;
  const activeId = controlled ? activePropertyId : internalActivePropertyId;
  const setActiveId = (propertyId: string | undefined) => {
    setInternalActivePropertyId(propertyId);
    onActivePropertyChange?.(propertyId);
  };

  return properties.map((property) => (
    <CustomPropertyField
      key={property.id}
      property={property}
      value={values[property.id]}
      open={activeId === property.id}
      onOpenChange={(open) => setActiveId(open ? property.id : undefined)}
      onChange={(value) => onChange(property.id, value)}
    />
  ));
}
