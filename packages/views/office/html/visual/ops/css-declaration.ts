/**
 * The inline-style declaration validator behind `setStyleDeclarations`.
 *
 * A declaration lands inside the user's own `style="..."` attribute and is saved
 * with the file, so it must (1) not load anything from the network in another
 * viewer, and (2) not change how the declarations AFTER it parse. Both are
 * decided by an ALLOWLIST, not a blocklist of known-bad names:
 *
 *   * functions: only the value functions below. `url(`, `image-set(`,
 *     `-webkit-image-set(`, `src(`, `image(`, `cross-fade(`, `element(`,
 *     `paint(`, `expression(` and any function CSS adds later are refused;
 *   * strings: only in `font-family`, where a family name needs quotes; a
 *     string anywhere else could carry a URL for a function that takes one;
 *   * no backslash (CSS escapes can spell a refused name), no `/*` comment, no
 *     control character or line separator, no `;{}<>@`, and quotes and
 *     parentheses must balance so a value never swallows the next declaration.
 */

const PROPERTY = /^[a-z-]+$/;
const FORBIDDEN_PUNCTUATION = ";{}<>@" + String.fromCharCode(92);

/** A character a value may never carry: structural punctuation, a control character or a line/paragraph separator. */
function isForbiddenChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || FORBIDDEN_PUNCTUATION.includes(char);
}
const FUNCTION_NAME = /[A-Za-z_-][A-Za-z0-9_-]*$/;

const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  "calc", "min", "max", "clamp", "var", "env",
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix",
  "linear-gradient", "radial-gradient", "conic-gradient",
  "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient",
  "translate", "translatex", "translatey", "translatez", "translate3d",
  "scale", "scalex", "scaley", "scalez", "scale3d",
  "rotate", "rotatex", "rotatey", "rotatez", "rotate3d",
  "skew", "skewx", "skewy", "matrix", "matrix3d", "perspective",
  "cubic-bezier", "steps",
  "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia",
]);

/** True when `declaration` (`property:value`) is safe to merge into a style attribute. */
export function isSafeDeclaration(declaration: string): boolean {
  const colon = declaration.indexOf(":");
  if (colon <= 0) return false;
  const property = declaration.slice(0, colon);
  const value = declaration.slice(colon + 1);
  if (!PROPERTY.test(property) || Array.from(value).some(isForbiddenChar) || value.includes("/*") || /javascript:/i.test(value)) return false;
  const stringsAllowed = property === "font-family";
  let depth = 0;
  for (let at = 0; at < value.length; at += 1) {
    const char = value[at]!;
    if (char === '"' || char === "'") {
      const close = value.indexOf(char, at + 1);
      if (!stringsAllowed || close < 0) return false;
      at = close;
    } else if (char === "(") {
      const name = FUNCTION_NAME.exec(value.slice(0, at));
      // `(` right after a name is a function call; a bare `(` only groups.
      if (name && !ALLOWED_FUNCTIONS.has(name[0].toLowerCase())) return false;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}
