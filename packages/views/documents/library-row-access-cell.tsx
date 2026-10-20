"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentShareScope } from "@uniwork/core/types/document";
import { cn } from "@uniwork/ui/lib/utils";
import { DocAccessCell } from "./doclist/cells";
import { shareScopeView } from "./document-share-scope-badge";
import { libraryCell, type RowLadder } from "./library-columns";
import type { DocumentSummaryRow } from "./library-rows";

/**
 * The Truy cập cell of a library row: the shared access pill (Riêng tư /
 * Workspace / Được chia sẻ) and, under it, "Chủ sở hữu" or the viewer's level
 * (doclist/cells.tsx). On a row that can be shared (`onShare` set) the
 * whole cell is one button that opens the Share dialog without opening the
 * document; a manager reads "Manage access for …", anyone else "View access
 * for …". Elsewhere (a folder, a source, a trashed row) it stays text.
 */
export function LibraryRowAccessCell({
  doc,
  scope,
  isOwner,
  title,
  workspaceName,
  ladder,
  onShare,
}: {
  doc: DocumentSummaryRow | null;
  scope: DocumentShareScope | null;
  isOwner: boolean;
  title: string;
  /** The home workspace's name when the viewer is in it, else empty (the badge never borrows another's). */
  workspaceName: string;
  ladder: RowLadder;
  /** Present only when the row passes the Share gate (canShareRow) and the host wires the dialog. */
  onShare?: (doc: DocumentSummaryRow) => void;
}) {
  const { t } = useTranslation();
  const scopeDescId = useId();
  const commandId = useId();
  const contentId = useId();
  const scopeInfo = scope ? shareScopeView(scope, t, workspaceName) : null;
  // The pill names the kind only; who exactly can reach the document (people,
  // workspaces, a link) is the badge tooltip's text, kept as the description.
  const described = scopeInfo && scopeInfo.tooltipText !== scopeInfo.label;
  const content = doc ? (
    <DocAccessCell visibility={doc.visibility} shareScope={scope} myLevel={doc.my_level} adminScope={doc.admin_scope} isOwner={isOwner} />
  ) : (
    <span className="text-muted-foreground">—</span>
  );
  const manage = doc?.my_level === "manage" || doc?.admin_scope === true;
  return (
    <td data-column="access" className={cn("px-3 py-2 text-caption", libraryCell(ladder, "access"))}>
      {onShare && doc ? (
        // The badge is not focusable here (it would nest a control inside the
        // button); its composition reaches the button as the description. The
        // name is the command plus the visible text (WCAG 2.5.3 label in name),
        // so the scope and the level are announced and speakable.
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onShare(doc);
          }}
          aria-labelledby={`${commandId} ${contentId}`}
          aria-describedby={described ? scopeDescId : undefined}
          className="-mx-1.5 -my-1 block w-[calc(100%+0.75rem)] min-w-0 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent pointer-coarse:min-h-11"
        >
          <span id={commandId} className="sr-only">
            {t(manage ? "documents.home.access.manage_for" : "documents.home.access.view_for", { title })}
          </span>
          <span id={contentId} className="block">
            {content}
          </span>
          {described ? (
            <span id={scopeDescId} className="sr-only">
              {scopeInfo?.tooltipText}
            </span>
          ) : null}
        </button>
      ) : (
        content
      )}
    </td>
  );
}
