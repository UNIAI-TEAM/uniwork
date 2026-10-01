import type { DesktopLibraryDocument } from "../../shared/ipc";
import { canDownloadDocument, type LibraryMode } from "./model";

type ElementLike = {
  textContent: string | null;
  value?: string;
  setAttribute(name: string, value: string): void;
  appendChild(child: unknown): unknown;
  addEventListener(type: string, listener: () => void): void;
};
type DocumentLike = { createElement(tag: string): ElementLike };
export type LibraryViewText = (key: "title" | "list" | "recent" | "search" | "download" | "open" | "engineDown" | "empty") => string;

const defaultText: Record<Parameters<LibraryViewText>[0], string> = {
  title: "Documents",
  list: "All documents",
  recent: "Recent",
  search: "Search",
  download: "Download",
  open: "Open",
  engineDown: "Editor unavailable; download remains available",
  empty: "No documents",
};

/** Small DOM renderer used by the sandboxed desktop entry point. It delegates
 * all actions to callbacks, so no privileged API or token can enter the view. */
export function renderLibrary(
  root: ElementLike,
  documentLike: DocumentLike,
  options: {
    mode: LibraryMode;
    documents: readonly DesktopLibraryDocument[];
    engineAvailable: boolean;
    searchQuery?: string;
    onModeChange?: (mode: LibraryMode) => void;
    onSearch?: (query: string) => void;
    onOpen?: (document: DesktopLibraryDocument) => void;
    onDownload?: (document: DesktopLibraryDocument) => void;
    t?: LibraryViewText;
  },
): void {
  const t = options.t ?? ((key) => defaultText[key]);
  root.textContent = "";
  root.setAttribute("data-desktop-library", "true");
  const heading = documentLike.createElement("h1");
  heading.textContent = t("title");
  root.appendChild(heading);
  const modes: readonly [LibraryMode, string][] = [["list", t("list")], ["recent", t("recent")], ["search", t("search")]];
  const nav = documentLike.createElement("nav");
  nav.setAttribute("aria-label", t("title"));
  for (const [mode, label] of modes) {
    const button = documentLike.createElement("button");
    button.textContent = label;
    button.setAttribute("type", "button");
    button.setAttribute("aria-current", options.mode === mode ? "page" : "false");
    button.addEventListener("click", () => options.onModeChange?.(mode));
    nav.appendChild(button);
  }
  root.appendChild(nav);
  if (options.mode === "search") {
    const search = documentLike.createElement("input");
    // The renderer submits search changes on blur/change instead of on every
    // keystroke. This lets the user finish typing without replacing the input
    // node (and losing its focus) while an async result is loading.
    search.value = options.searchQuery ?? "";
    search.textContent = "";
    search.setAttribute("type", "search");
    search.setAttribute("aria-label", t("search"));
    search.setAttribute("placeholder", t("search"));
    search.addEventListener("change", () => options.onSearch?.(search.value ?? ""));
    root.appendChild(search);
  }
  if (!options.engineAvailable) {
    const notice = documentLike.createElement("p");
    notice.textContent = t("engineDown");
    notice.setAttribute("role", "status");
    root.appendChild(notice);
  }
  if (options.documents.length === 0) {
    const empty = documentLike.createElement("p");
    empty.textContent = t("empty");
    root.appendChild(empty);
    return;
  }
  const list = documentLike.createElement("ul");
  list.setAttribute("aria-label", t("title"));
  for (const document of options.documents) {
    const row = documentLike.createElement("li");
    row.setAttribute("data-document-id", document.id);
    const title = documentLike.createElement("span");
    title.textContent = document.title;
    row.appendChild(title);
    const open = documentLike.createElement("button");
    open.textContent = t("open");
    open.setAttribute("type", "button");
    open.addEventListener("click", () => options.onOpen?.(document));
    row.appendChild(open);
    if (canDownloadDocument(document, options.engineAvailable)) {
      const download = documentLike.createElement("button");
      download.textContent = t("download");
      download.setAttribute("type", "button");
      download.addEventListener("click", () => options.onDownload?.(document));
      row.appendChild(download);
    }
    list.appendChild(row);
  }
  root.appendChild(list);
}
