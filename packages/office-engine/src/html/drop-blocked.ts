import { BLOCKED_URL } from "./preview-copy";

/** Attributes that load a resource. */
const RESOURCE_ATTRIBUTES = ["src", "srcset", "poster"];

/** Remove the resource attributes that carry {@link BLOCKED_URL}.
 *
 * The preview copy points a reference it will not serve (relative or remote
 * with no asset broker) at BLOCKED_URL; the frame's CSP then refuses that load
 * and logs a violation per attempt, which floods the console on every render.
 * With the attribute gone the frame makes no request and an `<img>` shows its
 * alt text. A copy without BLOCKED_URL is returned untouched (same string). */
export function dropBlockedResourceUrls(copy: string): string {
  if (!copy.includes(BLOCKED_URL)) return copy;
  const doc = new DOMParser().parseFromString(copy, "text/html");
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const name of RESOURCE_ATTRIBUTES) {
      if (element.getAttribute(name)?.includes(BLOCKED_URL)) element.removeAttribute(name);
    }
  }
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
