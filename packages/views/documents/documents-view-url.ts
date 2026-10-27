import { parseDriveLibrarySelection } from "@uniwork/core/paths";
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
    case "drive":
      return { kind: "drive", ...parseDriveLibrarySelection(searchParams) };
    default:
      return { kind: "home" };
  }
}

/** The documents URL a sidebar view resolves to; folders exist on Home only. */
export function buildDocumentsViewUrl(
  wsPaths: {
    documents: () => string;
    documentsFolder: (folderId: string) => string;
    documentsDrive?: (accountId?: string | null, folderId?: string | null) => string;
  },
  next: LibraryView,
  nextFolder: string | null,
): string {
  const targetFolder = next.kind === "home" ? nextFolder : null;
  if (targetFolder) return wsPaths.documentsFolder(targetFolder);
  const base = wsPaths.documents();
  if (next.kind === "home") return base;
  if (next.kind === "sources") return next.source ? `${base}?view=sources&source=${encodeURIComponent(next.source)}` : `${base}?view=sources`;
  if (next.kind === "drive") {
    if (wsPaths.documentsDrive) return wsPaths.documentsDrive(next.account, next.folder);
    return next.account ? `${base}?view=drive&account=${encodeURIComponent(next.account)}` : `${base}?view=drive`;
  }
  return `${base}?view=${next.kind === "sharedByMe" ? "shared-by-me" : next.kind}`;
}

/** True when two `LibraryView` values name the same sidebar destination. */
export function sameDocumentsView(a: LibraryView, b: LibraryView): boolean {
  return (
    a.kind === b.kind &&
    (a.kind !== "sources" || b.kind !== "sources" || a.source === b.source) &&
    (a.kind !== "drive" || b.kind !== "drive" || (a.account === b.account && a.folder === b.folder))
  );
}
