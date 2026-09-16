"use client";

import type { TaskProperty } from "@uniwork/core/types";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { DateField } from "../common/date-field";

type PropertyOption = { value: string; label: string };

function optionsFor(property: TaskProperty): PropertyOption[] {
  const raw = property.config?.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((option): PropertyOption[] => {
    if (typeof option === "string") return [{ value: option, label: option }];
    if (!option || typeof option !== "object") return [];
    const record = option as Record<string, unknown>;
    const value = record.value ?? record.id ?? record.name;
    const label = record.label ?? record.name ?? value;
    return typeof value === "string" && typeof label === "string" ? [{ value, label }] : [];
  });
}

export function CreateTaskCustomProperties({
  properties,
  values,
  onChange,
}: {
  properties: TaskProperty[];
  values: Record<string, unknown>;
  onChange: (propertyId: string, value: unknown | undefined) => void;
}) {
  return properties.map((property) => {
    const id = `task-property-${property.id}`;
    const value = values[property.id];
    const options = optionsFor(property);

    if (property.type === "checkbox") {
      return (
        <label key={property.id} className="flex items-center gap-2 text-body">
          <Checkbox checked={value === true} onCheckedChange={(checked) => onChange(property.id, checked)} />
          {property.name}
        </label>
      );
    }

    if (property.type === "select" && options.length > 0) {
      return (
        <div key={property.id} className="space-y-1.5">
          <Label htmlFor={id}>{property.name}</Label>
          <Select
            id={id}
            items={[{ value: "__none__", label: "—" }, ...options]}
            value={typeof value === "string" ? value : "__none__"}
            onValueChange={(next) => onChange(property.id, next === "__none__" ? undefined : next)}
          />
        </div>
      );
    }

    if (property.type === "multi_select" && options.length > 0) {
      const selected = new Set(
        Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
      );
      return (
        <fieldset key={property.id} className="space-y-1.5">
          <legend className="text-body font-medium">{property.name}</legend>
          <div className="flex flex-wrap gap-3">
            {options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-body">
                <Checkbox
                  checked={selected.has(option.value)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selected);
                    if (checked) next.add(option.value);
                    else next.delete(option.value);
                    onChange(property.id, next.size > 0 ? [...next] : undefined);
                  }}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    if (property.type === "date") {
      return (
        <div key={property.id} className="space-y-1.5">
          <Label htmlFor={id}>{property.name}</Label>
          <DateField id={id} value={typeof value === "string" ? value : ""} onChange={(next) => onChange(property.id, next || undefined)} modal={false} />
        </div>
      );
    }

    return (
      <div key={property.id} className="space-y-1.5">
        <Label htmlFor={id}>{property.name}</Label>
        <Input
          id={id}
          type={property.type === "number" ? "number" : property.type === "url" ? "url" : "text"}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(property.id, raw === "" ? undefined : property.type === "number" ? Number(raw) : raw);
          }}
        />
      </div>
    );
  });
}
