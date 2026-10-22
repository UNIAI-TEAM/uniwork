const BASE = "https://app.invalid";
// Whitespace, backslashes and control characters are stripped or rewritten by URL parsers ("/\x09/evil.com" becomes "//evil.com").
// eslint-disable-next-line no-control-regex -- control characters are exactly what this guard rejects
const UNSAFE = /[\s\\\u0000-\u001f\u007f]/;

/** True only for a path that stays inside the app: model-written and cited hrefs both pass through here before they become links. */
export function isInAppHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//") || UNSAFE.test(href)) return false;
  try {
    return new URL(href, BASE).origin === BASE;
  } catch {
    return false;
  }
}
