// C1 (UNI-924): Blob download for the exported HTML file. The web and desktop
// renderers are both DOM hosts, so one implementation serves both; a host that
// has no download primitive gets a typed false instead of a silent no-op.

const HTML_EXTENSION = ".html";
const UNSAFE_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

export function docxExportFileName(name: string): string {
  const cleaned = name.replace(HTML_EXTENSION, "").replace(UNSAFE_FILE_NAME, "-").trim();
  return `${cleaned || "document"}${HTML_EXTENSION}`;
}

export function downloadDocxHtmlFile(html: string, fileName: string, target: Document = document): boolean {
  const view = target.defaultView;
  const createObjectUrl = view?.URL?.createObjectURL;
  if (!view || typeof createObjectUrl !== "function" || typeof target.createElement !== "function") return false;
  const url = createObjectUrl.call(view.URL, new Blob([html], { type: "text/html;charset=utf-8" }));
  const anchor = target.createElement("a");
  anchor.href = url;
  anchor.download = docxExportFileName(fileName);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  target.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    view.URL.revokeObjectURL(url);
  }
  return true;
}
