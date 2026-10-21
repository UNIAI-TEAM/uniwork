import { isMyFolder, type DocumentTreeNode } from "@uniwork/core/types/document";
import type { LibraryView } from "../documents-sidebar";
import type { DocumentSummaryRow } from "../library-rows";
import type { DocListScreen } from "./columns";

// The glue between the documents page and the shared list spec: which screen
// a sidebar view shows, and where a row's document sits for the Name cell's
// location line.

/** The list screen of a sidebar view. The sources view has no screen column, like the workspace. */
export function docListScreenOfView(view: LibraryView): DocListScreen {
  switch (view.kind) {
    case "recent":
    case "starred":
    case "shared":
    case "shelved":
      return view.kind;
    case "sharedByMe":
      return "shared-by-me";
    case "archived":
      return "trash";
    default:
      return "workspace";
  }
}

/** The folder name of a document's parent from the loaded tree, or null at the root or when the parent is not loaded. */
export function folderNameLookup(tree: readonly DocumentTreeNode[], myFolderLabel: string): (doc: DocumentSummaryRow) => string | null {
  const names = new Map<string, string>();
  const walk = (nodes: readonly DocumentTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") names.set(node.id, isMyFolder(node) ? myFolderLabel : node.title);
      walk(node.children);
    }
  };
  walk(tree);
  return (doc) => (doc.parent_id ? (names.get(doc.parent_id) ?? null) : null);
}
