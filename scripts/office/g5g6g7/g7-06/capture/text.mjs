// Rendered text of a page for the `brand` check (contract section 2.4): the
// `innerText` of each frame, its title, the aria-label / title / alt /
// placeholder values of the visible elements, and what innerText leaves out:
// open shadow roots, ::before / ::after content, the value of visible inputs
// and textareas (never a password), the selected option of a select and SVG
// <text>. Frame URLs are deliberately NOT part of the text: the desktop modules
// live on a `genoffice-app://` scheme that no user ever reads.
//
// What cannot be read is said, not hidden: text painted into a <canvas> is not
// in the DOM, so a frame that is mostly canvas reports `canvasOnly` (meta.json)
// and the golden screenshot is the only check on it.

/** A frame whose visible canvases cover at least this share of its viewport "paints mainly into canvas". */
export const CANVAS_ONLY_RATIO = 0.5;

/** In-page collector. Serialised by Playwright, so it must not close over anything. */
export function collectFrameText() {
  // every open shadow root, nested ones included
  const roots = [document];
  for (let i = 0; i < roots.length; i += 1) {
    // the Next dev overlay's shadow roots are the dev server's UI, not the product's text
    for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot && !/^next(js-portal|-route-announcer)$/i.test(el.tagName)) roots.push(el.shadowRoot);
  }
  const attrs = [];
  const extra = [];
  let canvasArea = 0;
  const unquote = (content) => {
    if (!content || content === "none" || content === "normal") return "";
    // `"a" attr(x) "b"`: keep the quoted strings, drop counter()/attr()/url()
    const parts = [...content.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((m) => (m[1] ?? m[2] ?? "").replace(/\\([0-9a-f]{1,6}) ?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, "$1"));
    return parts.join("").trim();
  };
  for (const root of roots) {
    for (const el of root.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      // `visibility` is inherited, so the element's own computed value already covers its ancestors
      // (a display:none ancestor leaves every descendant without a box, which the rect test caught)
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const tag = el.tagName.toLowerCase();
      for (const name of ["aria-label", "title", "alt", "placeholder"]) {
        const value = el.getAttribute(name);
        if (value && value.trim()) attrs.push(value.trim());
      }
      for (const pseudo of ["::before", "::after"]) {
        const text = unquote(getComputedStyle(el, pseudo).content);
        if (text) extra.push(text);
      }
      if (tag === "input") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (!["password", "hidden", "checkbox", "radio", "range", "color", "file", "image"].includes(type) && el.value) extra.push(el.value);
      } else if (tag === "textarea") {
        if (el.value) extra.push(el.value);
      } else if (tag === "select") {
        const chosen = el.selectedOptions?.[0]?.textContent;
        if (chosen && chosen.trim()) extra.push(chosen.trim());
      } else if (tag === "text" && el instanceof SVGElement) {
        if (el.textContent && el.textContent.trim()) extra.push(el.textContent.trim());
      } else if (tag === "canvas") {
        canvasArea += rect.width * rect.height;
      }
    }
  }
  // innerText of the light DOM, plus each shadow root's children (innerText does not cross a shadow boundary)
  const bodyParts = [document.body ? document.body.innerText : ""];
  for (const root of roots.slice(1)) {
    for (const child of root.children) if (child.innerText) bodyParts.push(child.innerText);
  }
  const area = Math.max(1, window.innerWidth * window.innerHeight);
  return { title: document.title || "", body: bodyParts.join("\n"), attrs: [...extra, ...attrs], canvasRatio: Math.min(1, canvasArea / area) };
}

/** One frame's block of text: title, body, then each distinct attribute / pseudo / value line, one per line. */
export function frameBlock({ title, body, attrs }) {
  const lines = [];
  if (title.trim()) lines.push(title.trim());
  for (const line of String(body).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  const seen = new Set(lines);
  for (const value of attrs) {
    for (const line of String(value).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        lines.push(trimmed);
      }
    }
  }
  return lines.join("\n");
}

/** The `.txt` content from the per-frame results (top document first). Empty blocks are dropped. */
export function joinBlocks(results) {
  return `${results.map(frameBlock).filter((block) => block.length > 0).join("\n\n")}\n`;
}

/** Visible characters of a `.txt` (whitespace not counted), the number the job's `no_rendered_text` rule reads. */
export function visibleChars(text) {
  return String(text).replace(/\s+/g, "").length;
}

/**
 * Collects the text of the given frames of a Playwright page (default: every
 * frame, the top frame first). A frame that cannot be read (detached
 * mid-collection) is skipped and counted in `skipped`. `canvasOnly` is true
 * when any collected frame is mostly canvas (see the header).
 */
export async function collectRenderedText(page, frames = page.frames()) {
  const results = [];
  let skipped = 0;
  for (const frame of frames) {
    try {
      results.push(await frame.evaluate(collectFrameText));
    } catch {
      skipped += 1;
    }
  }
  const canvasRatio = results.reduce((max, result) => Math.max(max, result.canvasRatio ?? 0), 0);
  return { text: joinBlocks(results), frames: results.length, skipped, canvasRatio, canvasOnly: canvasRatio >= CANVAS_ONLY_RATIO };
}

/** `frame` and every frame below it. */
export function frameSubtree(page, frame) {
  return page.frames().filter((candidate) => {
    for (let at = candidate; at; at = at.parentFrame()) if (at === frame) return true;
    return false;
  });
}
