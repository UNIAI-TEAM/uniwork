// Number-format and fill decoding for the rich-paste reader (xlsx-clipboard-rich.ts):
// Excel writes `mso-number-format` with CSS escapes and its own named formats,
// and fills as hex, rgb() or a colour name.

import { XLSX_CUSTOM_FORMAT_MAX_LENGTH } from "./number-format/catalog";

/** Excel's named `mso-number-format` values (lower-case) as OOXML codes;
 *  null is General. */
const EXCEL_NAMED_FORMATS = new Map<string, string | null>(Object.entries({
  "general": null,
  "general number": null,
  "general date": "m/d/yyyy h:mm",
  "short date": "m/d/yyyy",
  "long date": "dddd, mmmm d, yyyy",
  "medium date": "d-mmm-yy",
  "short time": "h:mm",
  "long time": "h:mm:ss AM/PM",
  "medium time": "h:mm AM/PM",
  "percent": "0%",
  "fixed": "0.00",
  "standard": "#,##0.00",
  "currency": '"$"#,##0.00',
  "scientific": "0.00E+00",
  "yes/no": '"Yes";"Yes";"No"',
  "true/false": '"True";"True";"False"',
  "on/off": '"On";"On";"Off"',
}));

/** Letters a date/time code is made of; a letters-and-spaces string with any
 *  other letter is a name Excel knows ("Short Date"), not a pattern. */
const DATE_CODE_LETTERS = /^[ymdhsegbapYMDHSEGBAP\s]+$/;

/** CSS escapes: `\0022` (Excel always writes four hex digits) is a code point,
 *  `\#` is the character itself. */
function decodeCssEscapes(value: string): string {
  return value.replace(/\\([0-9a-f]{4}|[\s\S])/gi, (_, escaped: string) =>
    escaped.length === 4 ? String.fromCodePoint(Number.parseInt(escaped, 16)) : escaped);
}

/** The OOXML format code of a cell's `mso-number-format` declaration; null
 *  for General, an unknown named format or no declaration. */
export function excelNumberFormat(style: string): string | null {
  const match = /mso-number-format\s*:\s*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|(?:[^;\\]|\\[\s\S])+)/i.exec(style);
  if (!match) return null;
  const raw = match[1]!.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
  const decoded = decodeCssEscapes(quoted ? quoted[2]! : raw);
  const name = decoded.trim().toLowerCase();
  if (EXCEL_NAMED_FORMATS.has(name)) return EXCEL_NAMED_FORMATS.get(name)!;
  return /^[A-Za-z\s]+$/.test(decoded) && !DATE_CODE_LETTERS.test(decoded) ? null : decoded;
}

export function usableFormat(pattern: string | null): string | null {
  if (pattern === null || pattern === "" || pattern.toLowerCase() === "general") return null;
  // eslint-disable-next-line no-control-regex -- control characters never belong in a format code
  return pattern.length <= XLSX_CUSTOM_FORMAT_MAX_LENGTH && !/[\u0000-\u001f]/.test(pattern) ? pattern : null;
}

/** The colour names Excel writes for its standard fills, plus the common CSS
 *  greys; white, transparent and none are "no fill" and are left out. */
const NAMED_COLORS = new Map<string, string>(Object.entries({
  black: "#000000", red: "#ff0000", lime: "#00ff00", blue: "#0000ff", yellow: "#ffff00",
  aqua: "#00ffff", cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff",
  silver: "#c0c0c0", gray: "#808080", grey: "#808080", maroon: "#800000", olive: "#808000",
  green: "#008000", teal: "#008080", navy: "#000080", purple: "#800080",
  orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700",
  lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9", darkgrey: "#a9a9a9",
  lightblue: "#add8e6", lightgreen: "#90ee90", lightyellow: "#ffffe0", darkred: "#8b0000",
  darkblue: "#00008b", darkgreen: "#006400", tan: "#d2b48c", violet: "#ee82ee",
}));

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/** `#rgb`, `#rrggbb`, `rgb(r, g, b)`, a colour name or Excel's `windowtext`
 *  as `#rrggbb`; null when unreadable. */
export function cssColor(value: string | null): string | null {
  if (!value) return null;
  if (/\bwindowtext\b/i.test(value)) return "#000000";
  let color: string | null = null;
  const hexMatch = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(value);
  if (hexMatch) {
    const digits = hexMatch[1]!.toLowerCase();
    color = `#${digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits}`;
  } else {
    const rgb = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i.exec(value);
    if (rgb) color = `#${[rgb[1], rgb[2], rgb[3]].map((part) => hex(Math.min(255, Number(part)))).join("")}`;
    else {
      const name = value.toLowerCase().split(/[\s;]+/).find((word) => NAMED_COLORS.has(word));
      if (name) color = NAMED_COLORS.get(name)!;
    }
  }
  return color;
}

/** A fill colour; white (and anything unreadable) is "no fill". */
export function fillColor(value: string | null): string | null {
  if (value && /\bwindowtext\b/i.test(value)) return null;
  const color = cssColor(value);
  return color === "#ffffff" ? null : color;
}
