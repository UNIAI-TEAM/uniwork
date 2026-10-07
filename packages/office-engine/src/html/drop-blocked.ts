import { BLOCKED_URL } from "./preview-copy";

/** Attributes that load a resource: every slot the engine sweep can point at
 * BLOCKED_URL and a frame would fetch (`href` is handled apart, see below).
 * `action`, `formaction` and `ping` only matter on a navigation the user
 * starts, so they stay. */
const RESOURCE_ATTRIBUTES = ["src", "srcset", "poster", "data", "background", "xlink:href"];

/** Elements whose `href` only navigates when followed; every other `href`
 * (a stylesheet `<link>`, an svg `<image>` or `<use>`) is fetched on render. */
const NAVIGATION_ONLY_HREF = new Set(["a", "area"]);

/** Attributes that only make sense on an image that loads. */
const IMAGE_ONLY_ATTRIBUTES = new Set(["alt", "sizes", "loading", "decoding", "width", "height", "usemap", "ismap"]);

/** A blocked `<img>` still paints the browser's broken-image icon before its
 * alt text. Swap it for an inline span that carries the alt text alone, keeping
 * the other attributes (class, style, the visual-edit sid) so the element stays
 * selectable and styled the same way. */
function showAltOnly(doc: Document, img: Element): void {
  const span = doc.createElement("span");
  for (const name of img.getAttributeNames()) {
    if (!IMAGE_ONLY_ATTRIBUTES.has(name)) span.setAttribute(name, img.getAttribute(name) ?? "");
  }
  span.setAttribute("data-blocked-image", "");
  span.textContent = img.getAttribute("alt") ?? "";
  img.replaceWith(span);
}

/** Remove the resource attributes that carry {@link BLOCKED_URL}.
 *
 * The preview copy points a reference it will not serve (relative or remote
 * with no asset broker) at BLOCKED_URL; the frame's CSP then refuses that load
 * and logs a violation per attempt, which floods the console on every render.
 * With the attribute gone the frame makes no request; an `<img>` left with no
 * source becomes an inline span holding its alt text, so no broken-image icon shows. A copy without BLOCKED_URL is returned untouched (same string). */
export function dropBlockedResourceUrls(copy: string): string {
  if (!copy.includes(BLOCKED_URL)) return copy;
  const doc = new DOMParser().parseFromString(copy, "text/html");
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const name of RESOURCE_ATTRIBUTES) {
      if (element.getAttribute(name)?.includes(BLOCKED_URL)) element.removeAttribute(name);
    }
    if (!NAVIGATION_ONLY_HREF.has(element.localName) && element.getAttribute("href")?.includes(BLOCKED_URL)) {
      if (element.localName === "link") {
        element.remove();
        continue;
      }
      element.removeAttribute("href");
    }
    if (element.localName === "img" && !element.hasAttribute("src") && !element.hasAttribute("srcset")) showAltOnly(doc, element);
  }
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
