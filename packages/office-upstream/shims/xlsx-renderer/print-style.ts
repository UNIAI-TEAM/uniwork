// UNI-952 (visual r1 M2): a cell's composed style for print. Univer's
// conditional-formatting builder stores its colours as ColorKit rgb strings
// ("rgb(255,199,206)", "rgba(...)") while the journal converter keeps only
// "#RRGGBB" - so a CF fill or font colour the canvas paints dropped out of
// the print copy. Colours are brought to hex here before conversion; alpha
// is dropped (a print cell is opaque, as Excel's dxf colours are).
import { toNeutralStyle } from "../../upstream/apps/sheets/src/renderer/edit-journal";

const RGB_FUNCTION = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+%?\s*)?\)$/i;

const channel = (value: string): string => Math.min(255, Number(value)).toString(16).padStart(2, "0").toUpperCase();

/** A Univer colour ({ rgb }) with an rgb()/rgba() string turned into hex. */
function hexColor(color: unknown): unknown {
  if (typeof color !== "object" || color === null) return color;
  const rgb = (color as { rgb?: unknown }).rgb;
  const match = typeof rgb === "string" ? RGB_FUNCTION.exec(rgb.trim()) : null;
  if (!match) return color;
  return { ...color, rgb: `#${channel(match[1]!)}${channel(match[2]!)}${channel(match[3]!)}` };
}

/** The composed Univer style in the renderer-neutral wire shape, or null. */
export function printStyleOf(composed: Record<string, unknown>): NonNullable<ReturnType<typeof toNeutralStyle>> | null {
  const style: Record<string, unknown> = { ...composed };
  if ("cl" in style) style.cl = hexColor(style.cl);
  if ("bg" in style) style.bg = hexColor(style.bg);
  if (typeof style.bd === "object" && style.bd !== null) {
    style.bd = Object.fromEntries(Object.entries(style.bd as Record<string, unknown>).map(([edge, value]) => [
      edge,
      typeof value === "object" && value !== null && "cl" in value ? { ...value, cl: hexColor((value as { cl: unknown }).cl) } : value,
    ]));
  }
  return toNeutralStyle(style) ?? null;
}
