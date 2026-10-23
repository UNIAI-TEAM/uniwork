"use client";

import { useTranslation } from "react-i18next";
import type { TaskProperty } from "@uniwork/core/types";
import { tintClass, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { tintFromColor } from "@uniwork/ui/lib/tint-from-color";
import { cn } from "@uniwork/ui/lib/utils";
import { formatPropertyValue, propertyOptions, readPropertyValue } from "./property-value";

function EmptyValue({ className }: { className?: string }) {
  const { t } = useTranslation();
  return <span className={cn("text-muted-foreground", className)}>{t("tasks.properties.empty")}</span>;
}

/**
 * Read-only rendering of a task's stored value for `property` — the trigger
 * content for every `PropertyValueEditor` type, and the whole of it for an
 * archived property. `select`/`multi_select` render their option chip
 * (colour dot, or a tinted pill for each multi_select member) instead of
 * `formatPropertyValue`'s plain-text join, matching `LabelPicker`'s chips
 * (`table-cell-editors.tsx`); every other type falls through to the shared
 * text formatter.
 */
export function PropertyValueDisplay({
  property,
  value,
  className,
}: {
  property: TaskProperty;
  value: unknown;
  className?: string;
}) {
  const { i18n } = useTranslation();

  if (property.type === "checkbox") {
    const checked = readPropertyValue(property, value) === true;
    return (
      <Checkbox checked={checked} disabled aria-label={property.name} className={className} />
    );
  }

  if (property.type === "select") {
    const id = readPropertyValue(property, value) as string | undefined;
    if (id === undefined) return <EmptyValue className={className} />;
    const option = propertyOptions(property).find((o) => o.id === id);
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", tintSolidClass[tintFromColor(option?.color)])}
        />
        <span className="truncate">{option?.name ?? id}</span>
      </span>
    );
  }

  if (property.type === "multi_select") {
    const ids = (readPropertyValue(property, value) as string[] | undefined) ?? [];
    if (ids.length === 0) return <EmptyValue className={className} />;
    const options = propertyOptions(property);
    return (
      <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
        {ids.map((id) => {
          const option = options.find((o) => o.id === id);
          return (
            <span
              key={id}
              className={cn("max-w-24 truncate rounded px-1.5 py-0.5 text-caption", tintClass[tintFromColor(option?.color)])}
            >
              {option?.name ?? id}
            </span>
          );
        })}
      </span>
    );
  }

  const formatted = formatPropertyValue(property, value, i18n.language);
  if (!formatted) return <EmptyValue className={className} />;
  return (
    <span className={cn("truncate", className)} title={formatted}>
      {formatted}
    </span>
  );
}
