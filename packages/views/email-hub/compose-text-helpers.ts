export function wrapTextareaSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  fallback = "",
) {
  const selected = value.slice(start, end) || fallback;
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  const cursor = start + before.length + selected.length + after.length;
  return { next, cursor, selectionStart: start + before.length, selectionEnd: start + before.length + selected.length };
}

export function insertTextareaAtCursor(value: string, start: number, end: number, insert: string) {
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  const cursor = start + insert.length;
  return { next, cursor };
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtmlAttr(text: string) {
  return escapeHtml(text).replaceAll("'", "&#39;");
}

const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?.*)?$/i;

export function isImageUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return IMAGE_URL_RE.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Links and addresses are copied through untouched: their underscores are not italics. */
const LINK_RE = /(https?:\/\/[^\s<>"]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
const TRAILING_PUNCT_RE = /[.,;:!?)]+$/;

/**
 * Markers count only when they wrap whole words: `*quan trọng*` is bold, while
 * `5*3*2`, `bao_gia_v2` and a `utm_source=…&utm_medium` query stay literal.
 * They used to match anywhere, so sent links came out with `<em>` inside them.
 */
function formatWords(text: string) {
  return escapeHtml(text)
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gu, "$1<strong>$2</strong>")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>")
    .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, "<u>$1</u>");
}

function linkHtml(raw: string) {
  const trail = raw.match(TRAILING_PUNCT_RE)?.[0] ?? "";
  const link = trail ? raw.slice(0, -trail.length) : raw;
  const href = link.includes("@") && !link.startsWith("http") ? `mailto:${link}` : link;
  return `<a href="${escapeHtmlAttr(href)}">${escapeHtml(link)}</a>${escapeHtml(trail)}`;
}

function formatInline(line: string) {
  let html = "";
  let last = 0;
  for (const match of line.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    html += formatWords(line.slice(last, index)) + linkHtml(match[0]);
    last = index + match[0].length;
  }
  return html + formatWords(line.slice(last));
}

function imageHtml(url: string, alt = "") {
  return `<p><img src="${escapeHtmlAttr(url)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;display:block;" /></p>`;
}

export function plainTextToHtml(text: string) {
  const parts: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const markdown = trimmed.match(/^!\[(.*?)\]\((.+)\)$/);
    if (markdown?.[2] && isImageUrl(markdown[2])) {
      parts.push(imageHtml(markdown[2], markdown[1] ?? ""));
      continue;
    }
    if (trimmed && isImageUrl(trimmed)) {
      parts.push(imageHtml(trimmed));
      continue;
    }
    if (!trimmed) {
      parts.push("<br>");
      continue;
    }
    parts.push(`${formatInline(line)}<br>`);
  }
  while (parts.length && parts[parts.length - 1] === "<br>") {
    parts.pop();
  }
  return `<div>${parts.join("")}</div>`;
}

/**
 * Attached files travel as attachments only. Images used to be embedded again
 * as data URIs, which doubled the payload and showed the picture twice.
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export interface PrintDraftLabels {
  from: string;
  to: string;
  cc: string;
  subject: string;
}

/**
 * Prints the draft from a blank tab. `noopener` in the features string makes
 * `window.open` return null, which silently skipped printing; the opener link
 * is cut by hand instead. Returns false when the browser blocked the tab.
 */
export function printComposeDraft(
  input: { from: string; to: string; cc?: string; subject: string; body: string },
  labels: PrintDraftLabels,
): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.opener = null;
  const ccLine = input.cc?.trim() ? `<p><strong>${escapeHtml(labels.cc)}:</strong> ${escapeHtml(input.cc)}</p>` : "";
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(input.subject || "Email")}</title></head><body>
    <p><strong>${escapeHtml(labels.from)}:</strong> ${escapeHtml(input.from)}</p>
    <p><strong>${escapeHtml(labels.to)}:</strong> ${escapeHtml(input.to)}</p>
    ${ccLine}
    <p><strong>${escapeHtml(labels.subject)}:</strong> ${escapeHtml(input.subject)}</p>
    <hr />
    <pre style="white-space:pre-wrap;font-family:system-ui,sans-serif">${escapeHtml(input.body)}</pre>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
  return true;
}
