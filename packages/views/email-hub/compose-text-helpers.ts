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

function formatInline(text: string) {
  let html = escapeHtml(text);
  html = html.replace(/\*(.+?)\*/g, "<strong>$1</strong>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");
  html = html.replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, "<u>$1</u>");
  return html;
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

export async function buildComposeBodyHtml(text: string, files: File[]) {
  const html = plainTextToHtml(text);
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return html;
  const blocks = await Promise.all(
    images.map(async (file) => {
      const b64 = await readFileAsBase64(file);
      const src = `data:${file.type || "image/png"};base64,${b64}`;
      return imageHtml(src, file.name);
    }),
  );
  return `${html}${blocks.join("")}`;
}

export async function readFileAsBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

export function printComposeDraft(input: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
}) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  const ccLine = input.cc?.trim() ? `<p><strong>Cc:</strong> ${escapeHtml(input.cc)}</p>` : "";
  win.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(input.subject || "Email")}</title></head><body>
    <p><strong>From:</strong> ${escapeHtml(input.from)}</p>
    <p><strong>To:</strong> ${escapeHtml(input.to)}</p>
    ${ccLine}
    <p><strong>Subject:</strong> ${escapeHtml(input.subject)}</p>
    <hr />
    <pre style="white-space:pre-wrap;font-family:system-ui,sans-serif">${escapeHtml(input.body)}</pre>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
