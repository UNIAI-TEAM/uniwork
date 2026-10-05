import { buildHtmlPreviewCopy } from "@uniwork/office-engine/html";
import { buildMarkdownPreviewCopy } from "@uniwork/office-engine/markdown";
import { emptyAssetManifest } from "@uniwork/office-engine/assets";

/** Structural twin of `IsolatedPreviewPort` (packages/views/office/source-editor-types):
 * the views mount a preview only through a port the host injects. */
export interface DesktopPreviewMount {
  container: HTMLElement;
  format: "md" | "html";
  title: string;
  text: string;
  manifest?: unknown;
}
export interface DesktopPreviewSession {
  update(text: string): void;
  dispose(): void;
}
export interface DesktopTextPreviewPort {
  mount(options: DesktopPreviewMount): DesktopPreviewSession;
}

/** Deny by default. Local mode has no asset broker and no network, so remote and
 * relative images simply do not load; only inline data: images and fonts do. */
const PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
const DOCUMENT_PATH = { md: "document.md", html: "document.html" } as const;
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "xlink:href", "data", "poster", "background", "ping"];
const REMOVED_ELEMENTS = "script, iframe, frame, frameset, object, embed, applet, base, form, link, noscript";

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/** Markdown has no document shell of its own: wrap the engine's safe fragment so
 * the shared HTML pass below treats both formats the same way. */
function markdownDocument(text: string, title: string, dark: boolean): string {
  const ink = dark ? "#e5e7eb" : "#1f2937";
  const paper = dark ? "#111827" : "#ffffff";
  // Keep the document root measurable inside the desktop split pane. Chromium
  // can otherwise resolve an auto-height sandboxed srcdoc body to zero when
  // the iframe itself is sized by flex/grid percentage heights.
  const style = `html{min-height:100%;}body{min-height:100%;box-sizing:border-box;font:16px/1.6 system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1.5rem;color:${ink};background:${paper}}pre,code{font-family:ui-monospace,monospace}pre{overflow:auto}table{border-collapse:collapse}td,th{border:1px solid currentColor;padding:.25rem .5rem}img{max-width:100%}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>${style}</style></head><body>${buildMarkdownPreviewCopy({ source: text, document_path: DOCUMENT_PATH.md })}</body></html>`;
}

/** The engine's copy already neutralises URLs; this pass removes whatever could
 * still execute or navigate, working on an inert parsed document (DOMParser never
 * runs scripts), then pins the CSP as the first head child. */
function hardenCopy(copy: string): string {
  const doc = new DOMParser().parseFromString(copy, "text/html");
  doc.querySelectorAll(REMOVED_ELEMENTS).forEach((element) => element.remove());
  doc.querySelectorAll("meta[http-equiv]").forEach((element) => element.remove());
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      // Strip control characters and whitespace the URL parser would ignore.
      const value = Array.from(attribute.value).filter((char) => char.charCodeAt(0) > 0x20).join("").toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || (URL_ATTRIBUTES.includes(name) && value.startsWith("javascript:"))) element.removeAttribute(attribute.name);
    }
  }
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", PREVIEW_CSP);
  doc.head.prepend(csp);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/** The sanitized srcdoc for one preview: the engine's preview copy, then the
 * hardening pass. Never written back to the source text. */
function buildSrcdoc(format: "md" | "html", title: string, text: string): string {
  const colorScheme = isDark() ? "dark" : "light";
  const source = format === "md" ? markdownDocument(text, title, colorScheme === "dark") : text;
  const copy = buildHtmlPreviewCopy({ text: source, manifest: emptyAssetManifest(DOCUMENT_PATH[format]), assetUrl: () => null, scripts: false, csp: PREVIEW_CSP, color_scheme: colorScheme });
  return hardenCopy(copy);
}

/** The desktop preview port for one format: an `<iframe sandbox="">` (no
 * allow-scripts, no allow-same-origin) fed a sanitized `srcdoc`. */
export function createDesktopTextPreviewPort(format: "md" | "html"): DesktopTextPreviewPort {
  return {
    mount({ container, title, text }) {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "");
      frame.setAttribute("title", title);
      frame.setAttribute("data-testid", "desktop-text-preview");
      frame.style.cssText = "width:100%;height:100%;border:0;background:transparent";
      container.append(frame);
      let srcdoc = buildSrcdoc(format, title, text);
      const apply = () => {
        frame.setAttribute("srcdoc", srcdoc);
      };
      const initialRect = container.getBoundingClientRect();
      let wasHidden = initialRect.width === 0 || initialRect.height === 0;
      let firstObservation = true;
      // Chromium can keep a sandboxed srcdoc at zero layout height when its
      // host pane was display:none during navigation. Re-applying the copy
      // after the container becomes measurable forces a fresh document layout.
      const observer = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const visible = entry.contentRect.width > 0 && entry.contentRect.height > 0;
          if (visible && (firstObservation || wasHidden)) apply();
          wasHidden = !visible;
          firstObservation = false;
        }
      }) : null;
      observer?.observe(container);
      apply();
      return {
        update(next) { srcdoc = buildSrcdoc(format, title, next); apply(); },
        dispose() { observer?.disconnect(); frame.remove(); },
      };
    },
  };
}
