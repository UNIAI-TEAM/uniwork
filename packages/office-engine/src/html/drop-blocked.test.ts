// @vitest-environment jsdom
import { expect, it } from "vitest";
import { dropBlockedResourceUrls } from "./drop-blocked";
import { BLOCKED_URL } from "./preview-copy";

it("returns a copy without the blocked URL as the same string", () => {
  const copy = `<!doctype html><html><head></head><body><img src="data:image/png;base64,AA==" alt="a"></body></html>`;
  expect(dropBlockedResourceUrls(copy)).toBe(copy);
});

it("drops src, srcset and poster that carry the blocked URL and keeps the rest", () => {
  const copy = `<!doctype html><html><head></head><body><img src="${BLOCKED_URL}" srcset="${BLOCKED_URL} 2x" alt="Pic"><video poster="${BLOCKED_URL}"></video><img src="data:image/png;base64,AA==" alt="Inline"></body></html>`;
  const doc = new DOMParser().parseFromString(dropBlockedResourceUrls(copy), "text/html");
  const [pic, inline] = Array.from(doc.querySelectorAll("img"));
  expect(pic!.getAttributeNames()).toEqual(["alt"]);
  expect(doc.querySelector("video")!.hasAttribute("poster")).toBe(false);
  expect(inline!.getAttribute("src")).toBe("data:image/png;base64,AA==");
  expect(dropBlockedResourceUrls(copy)).not.toContain(BLOCKED_URL);
});
