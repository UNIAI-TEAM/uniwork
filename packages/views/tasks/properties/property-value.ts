import type { TaskProperty } from "@uniwork/core/types";

/** One choice of a `select`/`multi_select` property. `id` is the stored task
 * value; `name` is what the UI shows. */
export type PropertyOption = { id: string; name: string; color?: string };

/**
 * Parses `property.config.options` tolerantly — mirrors `optionsFor` in
 * `create-task-custom-properties.tsx` (also the shape the server's Task 2
 * ruling parses for grouping/sorting): an entry is either a bare string
 * (value = label = itself) or an object whose value is
 * `value ?? id ?? name` and whose label is `label ?? name ?? value`, both
 * required to be strings; an optional string `color` carries through.
 * Anything else in the array is dropped rather than thrown on — config comes
 * from the server's lenient JSON (`packages/core/api/schema.ts`).
 */
export function propertyOptions(property: TaskProperty): PropertyOption[] {
  const raw = property.config?.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((option): PropertyOption[] => {
    if (typeof option === "string") return [{ id: option, name: option }];
    if (!option || typeof option !== "object") return [];
    const record = option as Record<string, unknown>;
    const value = record.value ?? record.id ?? record.name;
    const name = record.label ?? record.name ?? value;
    if (typeof value !== "string" || typeof name !== "string") return [];
    const color = record.color;
    return [{ id: value, name, ...(typeof color === "string" ? { color } : {}) }];
  });
}

const URL_SCHEMES = new Set(["http:", "https:"]);

/** `true` for an absolute http(s) URL; `URL` itself accepts far more schemes. */
export function isValidUrl(value: string): boolean {
  try {
    return URL_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** "1.234,5" and "1234,5" both mean the same number in vi copy; only the
 * decimal comma is a UI affordance, so only the first one found is rewritten. */
function parseNumberInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" that also names a real calendar day (rejects "2026-13-40"). */
function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Parses a task's stored raw JSON value for `property` into its typed shape
 * — `string` for text/url/select/date, `number`, `string[]` for
 * multi_select, `boolean` for checkbox — or `undefined` when `raw` does not
 * fit the property's type. Never throws: server responses are lenient (API
 * Compatibility, CLAUDE.md), so a stale or hand-edited value degrades to
 * "no value" instead of crashing the editor.
 */
export function readPropertyValue(property: TaskProperty, raw: unknown): unknown {
  switch (property.type) {
    case "url":
      return typeof raw === "string" && isValidUrl(raw) ? raw : undefined;
    case "number":
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
      return typeof raw === "string" ? parseNumberInput(raw) : undefined;
    case "select":
      return typeof raw === "string" && raw !== "" ? raw : undefined;
    case "multi_select": {
      if (!Array.isArray(raw)) return undefined;
      const ids = raw.filter((item): item is string => typeof item === "string" && item !== "");
      return ids.length > 0 ? ids : undefined;
    }
    case "date":
      return typeof raw === "string" && isValidDateOnly(raw) ? raw : undefined;
    case "checkbox":
      return typeof raw === "boolean" ? raw : undefined;
    case "text":
    default:
      return typeof raw === "string" && raw !== "" ? raw : undefined;
  }
}

/**
 * Renders `raw` the way a table cell or sidebar row shows it — `""` when
 * `property` has no valid value for `raw` (callers show a localized
 * placeholder, `tasks.properties.empty`, for that case instead of a bare
 * blank). A `select`/`multi_select` member that no longer matches
 * `property.config.options` (the option was renamed or removed) still shows
 * its raw stored id rather than disappearing — same choice the server made
 * for facet labels (Task 3 ruling: "unknown select value labels as raw
 * value").
 */
export function formatPropertyValue(property: TaskProperty, raw: unknown, locale: string): string {
  const value = readPropertyValue(property, raw);
  if (value === undefined) return "";
  switch (property.type) {
    case "number":
      return new Intl.NumberFormat(locale).format(value as number);
    case "select": {
      const id = value as string;
      const option = propertyOptions(property).find((o) => o.id === id);
      return option?.name ?? id;
    }
    case "multi_select": {
      const options = propertyOptions(property);
      return (value as string[]).map((id) => options.find((o) => o.id === id)?.name ?? id).join(", ");
    }
    case "date": {
      const [y, m, d] = (value as string).split("-").map(Number) as [number, number, number];
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(
        new Date(y, m - 1, d),
      );
    }
    case "checkbox":
      return value === true ? "✓" : "";
    case "url":
    case "text":
    default:
      return value as string;
  }
}
