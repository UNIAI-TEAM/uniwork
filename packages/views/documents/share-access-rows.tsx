"use client";

import { FolderKanban, ShieldCheck } from "lucide-react";
import type { TFunction } from "react-i18next";
import type { DocumentAccessUpdateItemInput, DocumentPrincipalType } from "@uniwork/core/api/endpoints/documents-sharing";
import type { DocumentAccess, DocumentAccessLevel, DocumentAccessSource, DocumentAccessVia, DocumentShare } from "@uniwork/core/types/document";
import type { OrgMember } from "@uniwork/core/types/people";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { OwnerTransferAction } from "./owner-transfer-dialog";
import { allowedLevelsForPrincipal } from "./share-add-section";
import { SharePrincipalIcon } from "./share-candidate-picker";
import type { ShareDialogTarget } from "./share-dialog-target";

/** Everything a row needs from the list: labels, flags and callbacks. */
export interface ShareAccessRowContext {
  wsId: string;
  doc?: ShareDialogTarget;
  canManage: boolean;
  canTransfer: boolean;
  ownedByWorkProduct: boolean;
  updatePending: boolean;
  onOpenTransfer?: () => void;
  orgMembers?: readonly OrgMember[];
  t: TFunction;
  levelLabel: (lvl: DocumentAccessLevel | string | null | undefined) => string;
  viaLabel: (via: DocumentAccessVia | string) => string;
  resolveMemberName: (userId: string) => string | null;
  formatSourceOrigin: (src: Pick<DocumentAccessSource, "via" | "principal_type" | "principal_id">) => string;
  /** The control that opened a confirm panel takes its focus back (R4-02). */
  setOpenerEl: (opener: "revoke" | "level", rowKey: string, el: HTMLElement | null) => void;
  requestRowChange: (
    rowKey: string, principalType: DocumentPrincipalType, principalId: string,
    name: string, beforeLevel: DocumentAccessLevel | null, nextLevel: DocumentAccessLevel | null,
  ) => Promise<void>;
}

export interface ShareAccessHomeRow {
  workspace_id: string;
  workspace_name: string;
  level: DocumentAccessLevel | null;
}

export function NameOrSkeleton({ name }: { name: string | null }) {
  return name === null ? <Skeleton aria-hidden className="h-4 w-24" /> : <span className="min-w-0 truncate" title={name}>{name}</span>;
}

export function AclOwnerRow({ owner, ctx }: { owner: NonNullable<DocumentAccess["acl_owner"]>; ctx: ShareAccessRowContext }) {
  const { t, resolveMemberName, doc, orgMembers, canTransfer, ownedByWorkProduct, onOpenTransfer, wsId } = ctx;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2">
      <span className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-body text-foreground">
        <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <NameOrSkeleton name={resolveMemberName(owner.user_id)} />
        <span className="shrink-0 text-caption text-muted-foreground">{t("documents.share.acl_owner")}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-caption text-muted-foreground">
        {doc && orgMembers ? (
          <OwnerTransferAction
            wsId={wsId}
            doc={doc}
            ownerId={owner.user_id}
            ownerName={resolveMemberName(owner.user_id) ?? t("documents.share.person_unknown")}
            orgMembers={orgMembers}
          />
        ) : canTransfer ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={ownedByWorkProduct || undefined}
            onClick={ownedByWorkProduct ? undefined : onOpenTransfer}
          >
            {t("documents.share.owner.transfer_button")}
          </Button>
        ) : null}
      </span>
    </li>
  );
}

export function HomeWorkspaceRow({
  homeRow, homeRowKey, homeDisplayLabel, ctx, confirmPanel,
}: {
  homeRow: ShareAccessHomeRow;
  homeRowKey: string;
  homeDisplayLabel: string;
  ctx: ShareAccessRowContext;
  confirmPanel: React.ReactNode;
}) {
  const { t, levelLabel, canManage, setOpenerEl, requestRowChange, updatePending } = ctx;
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-body text-foreground">
          <FolderKanban aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate" title={homeDisplayLabel}>{homeDisplayLabel}</span>
          <Badge className="shrink-0" variant="secondary">{t("documents.share.home_badge")}</Badge>
        </span>
        {canManage ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {homeRow.level !== null ? (
              <div className="w-28 shrink-0">
                <Select
                  value={homeRow.level}
                  items={allowedLevelsForPrincipal("workspace", true).map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))}
                  onValueChange={(v) =>
                    void requestRowChange(homeRowKey, "workspace", homeRow.workspace_id, homeDisplayLabel, homeRow.level, v as DocumentAccessLevel)
                  }
                >
                  <SelectTrigger ref={(el) => setOpenerEl("level", homeRowKey, el)} className="w-full" aria-label={`${t("documents.share.level_label")} ${homeRow.workspace_name || t("documents.share.principal_workspace")}`}>
                    <SelectValue className="min-w-0">{levelLabel(homeRow.level)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {allowedLevelsForPrincipal("workspace", true).map((lvl) => (
                      <SelectItem key={lvl} value={lvl}>{levelLabel(lvl)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Badge variant="outline">{levelLabel(homeRow.level)}</Badge>
            )}
            <Button
              ref={(el) => setOpenerEl("revoke", homeRowKey, el)}
              type="button" variant="ghost" size="sm" disabled={updatePending}
              aria-label={`${t("documents.share.revoke")} ${homeDisplayLabel}`}
              onClick={() => void requestRowChange(homeRowKey, "workspace", homeRow.workspace_id, homeDisplayLabel, homeRow.level, null)}
            >
              {t("documents.share.revoke")}
            </Button>
          </div>
        ) : (
          <Badge variant="outline">{levelLabel(homeRow.level)}</Badge>
        )}
      </div>
      {confirmPanel}
    </li>
  );
}

export function ShareRow({
  share, rowKey, displayLabel, label, ctx, expanded, onToggleSources, confirmPanel,
}: {
  share: DocumentShare;
  rowKey: string;
  displayLabel: string;
  label: string | null;
  ctx: ShareAccessRowContext;
  expanded: boolean;
  onToggleSources: () => void;
  confirmPanel: React.ReactNode;
}) {
  const { t, levelLabel, viaLabel, formatSourceOrigin, canManage, setOpenerEl, requestRowChange, updatePending } = ctx;
  const allowedLevels = allowedLevelsForPrincipal(share.principal_type, false);
  const sources = share.sources ?? [];

  const directBelowGroupWarning = () => {
    if (!share.warnings?.includes("direct_below_group")) return null;
    const higherSource =
      share.sources?.find((src) => src.via !== "share" && src.level === share.effective_level) ??
      share.sources?.find((src) => src.via !== "share");
    const effectiveLevel = levelLabel(share.effective_level || higherSource?.level || "edit");
    const source = higherSource
      ? formatSourceOrigin(higherSource)
      : formatSourceOrigin({ via: (share.effective_via || "member") as DocumentAccessVia });
    return (
      <p className="text-caption text-warning" data-testid={`warning-direct-below-group-${share.principal_id}`}>
        {t("documents.share.warning_direct_below_group", { name: displayLabel, effectiveLevel, source })}
      </p>
    );
  };

  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1 basis-44">
          <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
            <SharePrincipalIcon principalType={share.principal_type} />
            <NameOrSkeleton name={label} />
            {!share.active ? (
              <span className="shrink-0 text-caption text-muted-foreground">{t("documents.share.inactive")}</span>
            ) : null}
          </span>
          <span className="block pl-5.5 text-caption text-muted-foreground">
            {levelLabel(share.level)}
            {share.effective_level && share.effective_level !== share.level
              ? ` · ${t("documents.share.effective", { level: levelLabel(share.effective_level) })}`
              : ""}
            {share.effective_via ? ` · ${viaLabel(share.effective_via)}` : ""}
          </span>
          {sources.length > 0 ? (
            <button
              type="button" aria-expanded={expanded}
              className="mt-0.5 pl-5.5 text-left text-caption text-muted-foreground underline hover:text-foreground"
              onClick={onToggleSources}
            >
              {t("documents.share.sources_toggle", { count: sources.length })}
            </button>
          ) : null}
        </div>

        {canManage ? (
          <span className="flex shrink-0 items-center gap-1.5">
            {share.level !== null ? (
              <div className="w-28 shrink-0">
                <Select
                  value={share.level}
                  disabled={!share.active}
                  items={allowedLevels.map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))}
                  onValueChange={(v) =>
                    void requestRowChange(rowKey, share.principal_type as DocumentPrincipalType, share.principal_id, displayLabel, share.level, v as DocumentAccessLevel)
                  }
                >
                  <SelectTrigger ref={(el) => setOpenerEl("level", rowKey, el)} className="w-full" aria-label={`${t("documents.share.level_label")} ${displayLabel}`}>
                    <SelectValue className="min-w-0">{levelLabel(share.level)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {allowedLevels.map((lvl) => (
                      <SelectItem key={lvl} value={lvl}>{levelLabel(lvl)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Badge variant="outline">{levelLabel(share.level)}</Badge>
            )}
            <Button
              ref={(el) => setOpenerEl("revoke", rowKey, el)}
              type="button" variant="ghost" size="sm" disabled={updatePending}
              aria-label={`${t("documents.share.revoke")} ${label ?? ""}`.trim()}
              onClick={() =>
                void requestRowChange(rowKey, share.principal_type as DocumentPrincipalType, share.principal_id, displayLabel, share.level, null)
              }
            >
              {t("documents.share.revoke")}
            </Button>
          </span>
        ) : null}
      </div>

      {directBelowGroupWarning()}

      {expanded && sources.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-caption text-muted-foreground">
          {sources.map((src, idx) => (
            <li key={`${src.via}-${src.principal_id ?? idx}`} className="break-words">
              {t("documents.share.source_item", { level: levelLabel(src.level), source: formatSourceOrigin(src) })}
            </li>
          ))}
        </ul>
      ) : null}

      {confirmPanel}
    </li>
  );
}
