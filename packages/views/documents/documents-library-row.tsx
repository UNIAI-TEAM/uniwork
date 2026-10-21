"use client";

import { Fragment, useId, useRef, type ReactNode } from "react";
import { Ellipsis, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isMyFolder, isShelved } from "@uniwork/core/types/document";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@uniwork/ui/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { useOptionalWorkspace } from "../layout/workspace-context";
import type { FrameDesktopOpenProps } from "../office";
import { DesktopOpenAction, type DesktopOpenOutcome } from "../office/desktop-open-action";
import {
  DocumentShareScopeBadge,
  isPlainHomeWorkspaceScope,
  shareScopeView,
} from "./document-share-scope-badge";
import { EditLockHolderChip } from "./edit-lock-holder-chip";
import { docAccessLevel } from "./doclist/access";
import { DocNameCell, DocPersonCell } from "./doclist/cells";
import { docListSpec, type DocListScreen } from "./doclist/columns";
import { EMPTY_CELL, formatBytes, formatListDate } from "./doclist/format";
import { docListRowFields } from "./doclist/row-fields";
import { DocLifecycleAction, type DocLifecycleHandlers } from "./doclist/lifecycle-action";
import type { RowMenuHandlers } from "./doclist/row-menu";
import { DocStarAction } from "./doclist/star-action";
import { DocScreenCell, DocScreenLine, type DocListMemberLookup } from "./doclist/screen-cells";
import { libraryCell, libraryPad, type RowLadder } from "./library-columns";
import { LibraryRowAccessCell } from "./library-row-access-cell";
import { canShareRow, rowAppOperation, rowLevel } from "./row-level";
import { sourceLinkIcon, sourceLinkLabelKey, sourceLinkNamedLabelKey, sourceOpenAction, sourceParentLinked } from "./source-links";
import { docRowMenu } from "./doclist/row-menu";
import { RowMenuItems } from "./doclist/row-menu-items";
import {
  isFolderRow,
  rowFormat,
  rowSizeBytes,
  rowTitle,
  rowUpdatedAt,
  type DocumentSummaryRow,
  type LibraryRow,
} from "./library-rows";

/** The formats UniWork Office opens; a page, folder or other file has no app action. */
const APP_FORMATS = new Set(["docx", "xlsx", "pptx", "pdf", "md", "html"]);

/** How a library row reaches "Open in UniWork Office" (host wiring, per row). */
export type LibraryDesktopOpen = (doc: { id: string; organization_id: string; current_version: number }) => FrameDesktopOpenProps;

export interface LibraryRowHandlers
  extends Pick<RowMenuHandlers, "onUnshelve" | "onRestore" | "onViewDetails" | "onPurge">,
    DocLifecycleHandlers {
  onOpen: (documentId: string) => void;
  onFolder: (folderId: string) => void;
  onGoToSource: (row: Extract<LibraryRow, { type: "source" }>) => void;
  /** Image sources only: fetches the bytes and opens them view-only. */
  /** Office formats the server marks openable (UNI-1869): opens the view-only module frame; absent falls back to download. */
  onViewSource?: (source: DocumentSourceFile) => void;
  onDownloadSource: (sourceId: string) => void;
  onSaveSource: (row: Extract<LibraryRow, { type: "source" }>) => void;
  /** Absent outside an organization (no favorites there). */
  onToggleStar?: (documentId: string, starred: boolean) => void;
  isStarred: (documentId: string) => boolean;
  /**
   * Create subfolder, rename, move to another folder, and archive, for people
   * who may change the open folder; absent hides them. The server still decides per document.
   */
  onNewSubfolder?: (doc: DocumentSummaryRow) => void;
  onRename?: (doc: DocumentSummaryRow) => void;
  onMove?: (doc: DocumentSummaryRow) => void;
  onArchive?: (doc: DocumentSummaryRow) => void;
  /**
   * Opens the Share dialog without opening the document (UNI-2009): the row's
   * Share action and its Access cell. Every reader gets it where canShareRow
   * allows; the dialog shows a manager the controls and anyone else their own
   * level. Absent where the host mounts no dialog.
   */
  onShare?: (doc: DocumentSummaryRow) => void;
  /** Lưu trữ (ARCHIVE-01 U-4): manage-only, hidden on My Folder; the page
   *  wires it so a folder opens the confirm dialog and a document shelves at
   *  once with an undo toast. */
  onShelve?: (doc: DocumentSummaryRow) => void;
  /** Sao chép link / Tạo bản sao / Tải xuống on a document row (UNI-2045 W8); absent hides the item. */
  onCopyLink?: (doc: DocumentSummaryRow) => void;
  onDuplicate?: (doc: DocumentSummaryRow) => void;
  onDownload?: (doc: DocumentSummaryRow) => void;
  /** Names who deleted / shelved a row in the Thùng rác and Lưu trữ columns. */
  member?: DocListMemberLookup;
  /** The display name of a person id, or null when unknown. */
  personName: (userId: string, kind: string) => string | null;
  /** The folder a document sits in, for the Name cell's location line; absent draws none. */
  locationName?: (doc: DocumentSummaryRow) => string | null;
  desktopOpen?: LibraryDesktopOpen;
}

export function LibraryRowView({
  row,
  handlers,
  ladder,
  screen = "workspace",
  highlighted = false,
  selection,
}: {
  row: LibraryRow;
  handlers: LibraryRowHandlers;
  /** The column ladder the list's header and colgroup were built from (library-columns.ts). */
  ladder: RowLadder;
  /** The screen the list shows (doclist/columns.ts); "shared-by-me" also keeps the plain home-workspace scope on the narrow line (SW-V2). */
  screen?: DocListScreen;
  /** The row a notification pointed at (`?focus=` on Thùng rác): ringed apart from hover. */
  highlighted?: boolean;
  /** Bulk selection (W9): the row's state, and its toggle when the bar has an action for it (`range` = shift). */
  selection?: { selected: boolean; onToggle?: (range: boolean) => void };
}) {
  const { t, i18n } = useTranslation();
  const appRequest = useRef<(() => Promise<DesktopOpenOutcome>) | null>(null);
  const scopeDescId = useId();
  const currentWorkspace = useOptionalWorkspace()?.workspace;
  const doc = row.type === "document" ? row.doc : null;
  const myFolder = isMyFolder(doc);
  const title = (myFolder ? t("documents.home.my_folder.label") : rowTitle(row)) || t("documents.detail.untitled");
  const format = rowFormat(row);
  const folder = isFolderRow(row);
  const source = row.type === "source" ? row.source : null;
  const sourceLinked = source ? sourceParentLinked(source.parent) : false;

  // The agreed optional list fields (SV-1..SV-6); each reads undefined until the schema parses it.
  const fields = doc ? docListRowFields(doc) : {};
  // SV-6 names the editor with their photo; without it the member list does both (a photo-less SV-6 editor draws the initial).
  const editor = doc
    ? fields.updatedByUser?.name ?? (doc.updated_by ? handlers.personName(doc.updated_by, doc.updated_by_kind) : null)
    : source?.owner?.name || null;
  const memberEditor = doc?.updated_by && !fields.updatedByUser ? handlers.member?.(doc.updated_by) : null;
  const editorAvatar = fields.updatedByUser ? fields.updatedByUser.avatarUrl : memberEditor && memberEditor !== "former" ? memberEditor.avatarUrl : null;
  // The shared list formats answer "—" for nothing to show; the narrow meta line
  // below leaves such a part out instead of printing the dash.
  const size = formatBytes(rowSizeBytes(row), i18n.language);
  const updated = formatListDate(rowUpdatedAt(row), new Date(), i18n.language, { yesterday: t("documents.list.date.yesterday") });

  // "Open in app" sits on every document file row (user decision 6); a viewer
  // gets a read-only session. Source files have no launch route yet
  // (api-contract §4): they offer the download instead.
  // A starred row whose document is not in any loaded list has no version or
  // organisation yet: no app action until the document is known.
  const desktop =
    doc && doc.kind === "file" && doc.current_version > 0 && APP_FORMATS.has(format) && handlers.desktopOpen && !doc.archived_at && screen !== "shelved"
      ? handlers.desktopOpen({ id: doc.id, organization_id: doc.organization_id, current_version: doc.current_version })
      : null;
  const level = rowLevel(doc);
  // The Truy cập cell is the shared pill + level line (DocAccessCell); the
  // narrow secondary line shows the level word and any non-default scope until the column joins.
  // SV-5 `is_owner` when the response carries it; until then a row reached via ownership reads as the owner's.
  const isOwner = fields.isOwner ?? doc?.via === "owner";
  const accessLevel = doc ? docAccessLevel(doc.my_level, doc.admin_scope) : null;
  // A row without `share_scope` shows no scope; it is never guessed from `visibility`.
  // A folder is never shared (UNI-1974), so it shows none whatever a row carries.
  const scope = doc && doc.kind !== "folder" ? (doc.share_scope ?? null) : null;
  // On Shared by me the plain "home workspace" scope is the answer the reader
  // came for (SW-V2); on every other view the narrow line omits the default.
  const showNarrowScope = Boolean(scope && (screen === "shared-by-me" || !isPlainHomeWorkspaceScope(scope)));
  const levelLabel = doc && isOwner ? t("documents.list.access.owner") : accessLevel ? t(`documents.list.access.level.${accessLevel}`) : null;
  // Same resolution the badge applies: only the viewer's current workspace is named.
  const resolvedWorkspaceName = (!doc?.workspace_id || doc.workspace_id === currentWorkspace?.id ? (currentWorkspace?.name ?? "") : "").trim();
  // SW-V4: the narrow badge is not focusable inside the name button, so the
  // scope composition reaches the keyboard through the button's description
  // (the badge's hidden span via scopeDescId) and the ⋯ menu label.
  const scopeInfo = showNarrowScope && scope ? shareScopeView(scope, t, resolvedWorkspaceName) : null;
  const starred = Boolean(doc && handlers.isStarred(doc.id));
  const metaTail = [updated, size].filter((part) => part !== EMPTY_CELL).join(" · ");

  // A trashed row runs only what the Thùng rác screen wires (its menu, below);
  // on a live list such a row is inert.
  const trashed = Boolean(doc?.archived_at);

  const primary = () => {
    if (doc && trashed) handlers.onViewDetails?.(doc);
    // A shelved item opens read-only; a shelved folder never browses.
    else if (doc && screen === "shelved") handlers.onOpen(doc.id);
    else if (doc && folder) handlers.onFolder(doc.id);
    else if (doc) handlers.onOpen(doc.id);
    else if (row.type === "source") {
      // U-SRC1 + UNI-1869: the primary click opens the file view-only where the
      // row can (the module frame for an Office format), else downloads it; "Xem nơi đính kèm" is a secondary.
      const open = sourceOpenAction(row.source);
      if (open === "office" && handlers.onViewSource) handlers.onViewSource(row.source);
      else handlers.onDownloadSource(row.source.id);
    }
  };

  // Share is not a level-gated command: every reader opens the dialog (as
  // DocumentActionsMenu does); the Access cell shares its gate with the menu item.
  const shareable = Boolean(doc && !trashed && handlers.onShare && canShareRow(doc));
  // One ordered menu for the ⋯ dropdown and the right-click menu (doclist/row-menu.ts).
  const menu = docRowMenu(row, {
    handlers,
    starred,
    open: primary,
    openApp: desktop ? () => void appRequest.current?.() : undefined,
    screen,
  });
  // The title opens a trashed row only where its menu offers Xem chi tiết (manage, never a folder).
  const inert = trashed && !menu.some((group) => group.some((item) => item.id === "view-details"));
  // The app command joins the actions cell only when its column is wide
  // enough (the ladder's quick rung); the source's own link button below
  // is icon-sized and rendered at every width.
  const quick = desktop ? (
    <DesktopOpenAction
      {...desktop}
      documentId={doc!.id}
      placement="row"
      operation={rowAppOperation(level)}
      requestRef={appRequest}
    />
  ) : null;

  // S2V-2/3: "Xem nơi đính kèm" / "Mở Email" as an icon button, so it fits the
  // actions column at every width instead of covering Size. The words live on
  // the tooltip and inside the accessible name.
  const SourceLinkGlyph = source ? sourceLinkIcon(source.parent) : null;
  const sourceLink = source && sourceLinked && SourceLinkGlyph ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t(sourceLinkNamedLabelKey(source.parent), { title })}
            onClick={() => row.type === "source" && handlers.onGoToSource(row)}
          />
        }
      >
        <SourceLinkGlyph aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{t(sourceLinkLabelKey(source.parent))}</TooltipContent>
    </Tooltip>
  ) : null;

  const screenColumn = docListSpec(screen).screenColumn;
  const nameCell = (
    <DocNameCell
      kind={folder ? "folder" : (doc?.kind ?? "file")}
      format={folder ? "folder" : format}
      title={title}
      location={doc && screen !== "workspace" ? (handlers.locationName?.(doc) ?? null) : null}
      badges={
        <>
          {starred ? (
            <Star role="img" aria-label={t("documents.home.row.starred")} className="size-3.5 shrink-0 fill-current text-brand" />
          ) : null}
          {trashed && screen !== "trash" ? (
            <Badge variant="secondary" className="shrink-0">{t("documents.library.archived_badge")}</Badge>
          ) : null}
          {/* U-11: a shelved row that also sits in the trash keeps its "Đã lưu trữ" label. */}
          {screen === "trash" && isShelved(doc) ? (
            <Badge variant="secondary" className="shrink-0">{t("documents.shelved_list.badge")}</Badge>
          ) : null}
          {doc?.edit_lock && !doc.edit_lock.held_by_me ? (
            <EditLockHolderChip
              name={doc.edit_lock.holder_name}
              avatarUrl={doc.edit_lock.holder_avatar_url}
              offlineHoldUntil={doc.edit_lock.offline_hold_until}
            />
          ) : null}
        </>
      }
    >
      {/* Below the table rung the row stacks under Name: the screen column's content first (it never hides), then the stand-ins below. */}
      {screenColumn ? <DocScreenLine column={screenColumn} fields={fields} member={handlers.member} className={ladder.screenLineHides} /> : null}
      {/* Below 34rem the meta group (editor · date · size) and level · share scope stay on separate lines (the editor needs the room until ~33rem); from 34rem they join one line until their columns take over (library-columns.ts). */}
      {editor || metaTail || levelLabel || showNarrowScope ? (
        <span
          data-library-access-line
          className={cn(
            "flex flex-wrap min-w-0 items-center gap-x-1.5 gap-y-0.5 overflow-hidden text-caption text-muted-foreground @min-[34rem]/library:flex-nowrap",
            ladder.accessLineHides,
          )}
        >
          {editor || metaTail ? (
            <span
              data-library-meta-line
              className={cn(
                "flex basis-full min-w-0 items-center gap-1.5 overflow-hidden @min-[34rem]/library:basis-auto",
                editor ? ladder.metaHides : ladder.metaTailHides,
              )}
            >
              {editor ? <span className={cn("min-w-0 truncate", ladder.metaHides)}>{editor}</span> : null}
              {editor && metaTail ? <span aria-hidden className={cn("shrink-0", ladder.metaTailHides)}>·</span> : null}
              {metaTail ? <span className={cn("shrink-0", ladder.metaTailHides)}>{metaTail}</span> : null}
            </span>
          ) : null}
          {editor && (levelLabel || showNarrowScope) ? (
            <span aria-hidden className={cn("hidden shrink-0 @min-[34rem]/library:inline", ladder.metaDotHides)}>·</span>
          ) : null}
          {levelLabel || showNarrowScope ? (
            <span data-library-access-group className={cn("flex shrink-0 items-center gap-1.5", ladder.accessGroupHides)}>
              {levelLabel ? <span className="shrink-0">{levelLabel}</span> : null}
              {levelLabel && showNarrowScope ? <span aria-hidden className="shrink-0">·</span> : null}
              {showNarrowScope ? (
                <DocumentShareScopeBadge
                  shareScope={doc?.share_scope}
                  workspaceId={doc?.workspace_id}
                  compact
                  focusable={false}
                  descriptionId={scopeDescId}
                />
              ) : null}
            </span>
          ) : null}
        </span>
      ) : null}
    </DocNameCell>
  );

  // Every column but Actions, in the ladder's order (doclist/columns.ts); the actions cell follows them below.
  const cells: Record<string, ReactNode> = {
    select: (
      <td data-column="select" className={cn("py-2", libraryPad(ladder, "select"))}>
        {selection?.onToggle ? (
          <Checkbox
            checked={selection.selected}
            onCheckedChange={(_checked, details) => selection.onToggle?.("shiftKey" in details.event && details.event.shiftKey === true)}
            aria-label={t("documents.list.bulk.select_row", { title })}
          />
        ) : null}
      </td>
    ),
    name: (
      <td data-column="name" className="px-3 py-2">
        {inert ? (
          <div className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11">{nameCell}</div>
        ) : (
          <button
            type="button"
            onClick={primary}
            aria-describedby={scopeInfo && scopeInfo.tooltipText !== scopeInfo.label ? scopeDescId : undefined}
            className="flex w-full min-w-0 items-center gap-3 text-left pointer-coarse:min-h-11"
          >
            {nameCell}
          </button>
        )}
      </td>
    ),
    access: (
      <LibraryRowAccessCell
        doc={doc}
        scope={scope}
        isOwner={isOwner}
        title={title}
        workspaceName={resolvedWorkspaceName}
        ladder={ladder}
        onShare={shareable ? handlers.onShare : undefined}
      />
    ),
    editor: (
      <td data-column="editor" className={cn("py-2", libraryPad(ladder, "editor"), libraryCell(ladder, "editor"))}>
        <DocPersonCell name={editor} avatarUrl={editorAvatar} kind={doc?.updated_by_kind} />
      </td>
    ),
    updated: (
      <td data-column="updated" className={cn("whitespace-nowrap py-2 font-mono text-caption tabular-nums text-muted-foreground", libraryPad(ladder, "updated"), libraryCell(ladder, "updated"))}>
        {updated}
      </td>
    ),
    size: (
      <td data-column="size" className={cn("whitespace-nowrap py-2 font-mono text-caption tabular-nums text-muted-foreground", libraryPad(ladder, "size"), libraryCell(ladder, "size"))}>
        {size}
      </td>
    ),
  };
  if (screenColumn) {
    cells[screenColumn] = (
      <td data-column={screenColumn} className={cn("py-2", libraryPad(ladder, screenColumn), libraryCell(ladder, screenColumn))}>
        {/* A source row (home root merge) has no screen field: it keeps its own cells and a dash here. */}
        <DocScreenCell column={screenColumn} fields={fields} member={handlers.member} />
      </td>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<tr />}
        data-library-row={row.id}
        data-focused={highlighted || undefined}
        aria-selected={selection ? selection.selected : undefined}
        className={cn(
          "group/row border-b border-border transition-colors last:border-b-0 hover:bg-accent/40",
          highlighted && "bg-accent/60 ring-2 ring-inset ring-ring",
        )}
      >
        {ladder.columns.map((column) => (column.id === "actions" ? null : <Fragment key={column.id}>{cells[column.id]}</Fragment>))}
        <td data-column="actions" className="px-2 py-2">
          <div className="flex items-center justify-end gap-1">
            {quick ? (
              // Until the actions column widens (first ladder rung) the app command lives in the ⋯ menu so the name keeps the row.
              <div className={cn("opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100", ladder.quick)}>
                {quick}
              </div>
            ) : null}
            {sourceLink ? (
              // Every width, not the quick rung: hover/focus reveals it on a
              // fine pointer, a coarse pointer shows it always (no hover there).
              <div className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                {sourceLink}
              </div>
            ) : null}
            {doc ? <DocStarAction menu={menu} title={title} starred={starred} /> : null}
            {doc ? <DocLifecycleAction screen={screen} doc={doc} title={title} handlers={handlers} /> : null}
            {menu.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("documents.home.row.menu", { title })} />
                  }
                >
                  <Ellipsis aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  {scopeInfo && scopeInfo.tooltipText !== scopeInfo.label ? (
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="font-normal normal-case tracking-normal">
                        {scopeInfo.tooltipText}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                  ) : null}
                  <RowMenuItems groups={menu} row={row} t={t} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </td>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {scopeInfo && scopeInfo.tooltipText !== scopeInfo.label ? (
          <ContextMenuGroup>
            <ContextMenuLabel className="font-normal normal-case tracking-normal">{scopeInfo.tooltipText}</ContextMenuLabel>
          </ContextMenuGroup>
        ) : null}
        <RowMenuItems groups={menu} row={row} t={t} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
