import { SOURCE_KINDS, type LibraryView } from "./documents-sidebar";

/** The sidebar view the `?view`/`?source`/`?folder` search params name. */
export function viewFromSearchParams(searchParams: URLSearchParams): LibraryView {
  if (searchParams.get("folder")) return { kind: "home" };
  const rawView = searchParams.get("view");
  switch (rawView) {
    case "recent":
    case "starred":
    case "shared":
    case "archived":
      return { kind: rawView };
    case "shared-by-me":
      return { kind: "sharedByMe" };
    case "shelved":
      return { kind: "shelved" };
    case "sources": {
      const rawSource = searchParams.get("source");
      const source =
        rawSource && (SOURCE_KINDS as readonly string[]).includes(rawSource)
          ? (rawSource as (typeof SOURCE_KINDS)[number])
          : null;
      return { kind: "sources", source };
    }
    default:
      return { kind: "home" };
  }
}

/** The documents URL a sidebar view resolves to; folders exist on Home only. */
export function buildDocumentsViewUrl(
  wsPaths: { documents: () => string; documentsFolder: (folderId: string) => string },
  next: LibraryView,
  nextFolder: string | null,
): string {
  const targetFolder = next.kind === "home" ? nextFolder : null;
  if (targetFolder) return wsPaths.documentsFolder(targetFolder);
  const base = wsPaths.documents();
  if (next.kind === "home") return base;
  if (next.kind === "sources") return next.source ? `${base}?view=sources&source=${encodeURIComponent(next.source)}` : `${base}?view=sources`;
  return `${base}?view=${next.kind === "sharedByMe" ? "shared-by-me" : next.kind}`;
}
