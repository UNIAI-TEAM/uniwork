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
  const [inline] = Array.from(doc.querySelectorAll("img"));
  expect(doc.querySelectorAll("img")).toHaveLength(1);
  expect(doc.querySelector("video")!.hasAttribute("poster")).toBe(false);
  expect(inline!.getAttribute("src")).toBe("data:image/png;base64,AA==");
  expect(dropBlockedResourceUrls(copy)).not.toContain(BLOCKED_URL);
});

it("renders a blocked image as alt text only, keeping class, style and other attributes", () => {
  const copy = `<!doctype html><html><head></head><body><img src="${BLOCKED_URL}" alt="Ảnh minh họa" class="hero" style="width:10px" data-sid-x="4" width="50"></body></html>`;
  const doc = new DOMParser().parseFromString(dropBlockedResourceUrls(copy), "text/html");
  expect(doc.querySelector("img")).toBeNull();
  const span = doc.querySelector("span[data-blocked-image]")!;
  expect(span.textContent).toBe("Ảnh minh họa");
  expect(span.getAttribute("class")).toBe("hero");
  expect(span.getAttribute("style")).toBe("width:10px");
  expect(span.getAttribute("data-sid-x")).toBe("4");
  expect(span.hasAttribute("src")).toBe(false);
  expect(span.hasAttribute("alt")).toBe(false);
});

it("keeps an img whose src is real even when srcset is blocked", () => {
  const copy = `<!doctype html><html><head></head><body><img src="data:image/png;base64,AA==" srcset="${BLOCKED_URL} 2x" alt="a"></body></html>`;
  const doc = new DOMParser().parseFromString(dropBlockedResourceUrls(copy), "text/html");
  expect(doc.querySelector("img")!.hasAttribute("srcset")).toBe(false);
});
