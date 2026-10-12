// Rendered text of a page for the `brand` check (contract section 2.4): the
// `innerText` of the top document and of every frame, each document's title,
// and the aria-label / title / alt / placeholder values of the visible
// elements. Frame URLs are deliberately NOT part of the text: the desktop
// modules live on a `genoffice-app://` scheme that no user ever reads.

/** In-page collector. Serialised by Playwright, so it must not close over anything. */
export function collectFrameText() {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  };
  const body = document.body ? document.body.innerText : "";
  const attrs = [];
  for (const el of document.querySelectorAll("[aria-label],[title],[alt],[placeholder]")) {
    if (!visible(el)) continue;
    for (const name of ["aria-label", "title", "alt", "placeholder"]) {
      const value = el.getAttribute(name);
      if (value && value.trim()) attrs.push(value.trim());
    }
  }
  return { title: document.title || "", body, attrs };
}

/** One frame's block of text: title, body, then each distinct attribute value, one per line. */
export function frameBlock({ title, body, attrs }) {
  const lines = [];
  if (title.trim()) lines.push(title.trim());
  for (const line of String(body).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  const seen = new Set(lines);
  for (const value of attrs) {
    if (!seen.has(value)) {
      seen.add(value);
      lines.push(value);
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
 * Collects the text of every frame of a Playwright page (`page.frames()` lists
 * the top frame first and every nested frame after it). A frame that cannot be
 * read (detached mid-collection) is skipped and counted in `skipped`.
 */
export async function collectRenderedText(page) {
  const results = [];
  let skipped = 0;
  for (const frame of page.frames()) {
    try {
      results.push(await frame.evaluate(collectFrameText));
    } catch {
      skipped += 1;
    }
  }
  return { text: joinBlocks(results), frames: results.length, skipped };
}
