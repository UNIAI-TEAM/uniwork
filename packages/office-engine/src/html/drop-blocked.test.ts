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

it("drops a blocked data (object) and background (table) attribute", () => {
  const copy = `<!doctype html><html><head></head><body><object data="${BLOCKED_URL}"></object><table background="${BLOCKED_URL}"><tr><td background="${BLOCKED_URL}">x</td></tr></table></body></html>`;
  const out = dropBlockedResourceUrls(copy);
  const doc = new DOMParser().parseFromString(out, "text/html");
  expect(out).not.toContain(BLOCKED_URL);
  expect(doc.querySelector("object")!.hasAttribute("data")).toBe(false);
  expect(doc.querySelector("table")!.hasAttribute("background")).toBe(false);
  expect(doc.querySelector("td")!.textContent).toBe("x");
});

it("drops a <link> whose href is blocked and keeps one with a real href", () => {
  const copy = `<!doctype html><html><head><link rel="stylesheet" href="${BLOCKED_URL}"><link rel="icon" href="${BLOCKED_URL}"><link rel="stylesheet" href="#frag"></head><body>x</body></html>`;
  const out = dropBlockedResourceUrls(copy);
  const doc = new DOMParser().parseFromString(out, "text/html");
  expect(out).not.toContain(BLOCKED_URL);
  expect(doc.querySelectorAll("link")).toHaveLength(1);
  expect(doc.querySelector("link")!.getAttribute("href")).toBe("#frag");
});

it("drops a blocked svg image href and xlink:href, but keeps an anchor href (navigation only)", () => {
  const copy = `<!doctype html><html><head></head><body><a href="${BLOCKED_URL}">go</a><svg><image href="${BLOCKED_URL}"></image><use xlink:href="${BLOCKED_URL}"></use></svg></body></html>`;
  const doc = new DOMParser().parseFromString(dropBlockedResourceUrls(copy), "text/html");
  expect(doc.querySelector("a")!.getAttribute("href")).toBe(BLOCKED_URL);
  expect(doc.querySelector("image")!.hasAttribute("href")).toBe(false);
  expect(doc.querySelector("use")!.hasAttribute("xlink:href")).toBe(false);
});
