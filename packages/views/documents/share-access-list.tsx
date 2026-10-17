"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, FolderKanban, ShieldCheck, UserRound, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { DocumentAccessPreview, DocumentAccessUpdateItemInput, DocumentPrincipalType } from "@uniwork/core/api/endpoints/documents-sharing";
import { useUpdateDocumentAccess } from "@uniwork/core/documents/hooks-sharing";
import type { DocumentAccess, DocumentAccessLevel, DocumentAccessSource, DocumentAccessVia, DocumentShare } from "@uniwork/core/types/document";
import type { OrgMember } from "@uniwork/core/types/people";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { OwnerTransferAction } from "./owner-transfer-dialog";
import { allowedLevelsForPrincipal } from "./share-add-section";
import { foldSearchText } from "./share-candidate-picker";
import { shareErrorMessage } from "./share-dialog-break-glass";
import type { ShareDialogTarget } from "./share-dialog-target";
import { revokeSentence, warningSentence, type PreviewSentence } from "./share-preview-sentences";

export interface ShareAccessListProps {
  wsId: string;
  docId: string;
  docWorkspaceId?: string;
  doc?: ShareDialogTarget;
  access?: DocumentAccess | null;
  canManage: boolean;
  adminScope?: boolean;
  canTransfer?: boolean;
  ownedByWorkProduct?: boolean;
  onOpenTransfer?: () => void;
  memberName?: (userId: string) => string | null;
  memberLabels?: Map<string, string>;
  workspaceName?: (wsId: string) => string;
  workspaceNames?: Map<string, string>;
  organization?: { id: string; name: string } | null;
  orgMembers?: readonly OrgMember[];
  locale?: string;
}

interface PendingRowConfirm {
  rowKey: string;
  name: string;
  item: DocumentAccessUpdateItemInput;
  sentence: PreviewSentence;
}

const FILTER_THRESHOLD = 20;

function NameOrSkeleton({ name }: { name: string | null }) {
  return name === null ? <Skeleton aria-hidden className="h-4 w-24" /> : <span className="truncate" title={name}>{name}</span>;
}

export function ShareAccessList({
  wsId, docId, docWorkspaceId, doc, access, canManage,
  adminScope = false, canTransfer = false, ownedByWorkProduct = false, onOpenTransfer,
  memberName, memberLabels, workspaceName, workspaceNames, organization, orgMembers,
}: ShareAccessListProps) {
  const { t } = useTranslation();
  const updateAccess = useUpdateDocumentAccess(wsId, docId);
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [pendingConfirm, setPendingConfirm] = useState<PendingRowConfirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // `isPending` is false between the dry_run resolving and the real call, so a
  // fast second click would write twice; the ref closes that gap.
  const inFlight = useRef(false);

  const myLevel = access?.my_level ?? "";
  const aclOwner = access?.acl_owner ?? null;
  const homeWorkspace = access?.home_workspace ?? null;
  const homeWsId = homeWorkspace?.workspace_id || docWorkspaceId || "";
  const rawShares = useMemo(() => access?.shares ?? [], [access?.shares]);

  const levelLabel = (lvl: DocumentAccessLevel | string) =>
    lvl === "manage" ? t("documents.share.level_manage")
    : lvl === "edit" ? t("documents.share.level_edit")
    : lvl === "comment" ? t("documents.share.level_comment")
    : t("documents.share.level_view");

  const viaLabel = (via: DocumentAccessVia | string) =>
    via === "break_glass" ? t("documents.breakGlass.viaBreakGlass")
    : via === "owner" ? t("documents.share.via_owner")
    : via === "member" ? t("documents.share.via_member")
    : via === "organization" ? t("documents.share.via_organization")
    : via === "link" ? t("documents.share.via_link")
    : via === "ai_context" ? t("documents.share.via_ai_context")
    : t("documents.share.via_share");

  const resolveMemberName = (userId: string): string | null => {
    if (memberName) return memberName(userId);
    if (memberLabels) return memberLabels.get(userId) ?? t("documents.share.person_unknown");
    return t("documents.share.person_unknown");
  };

  const resolveWsName = (id: string): string => {
    if (homeWorkspace && id === homeWorkspace.workspace_id && homeWorkspace.workspace_name) return homeWorkspace.workspace_name;
    if (workspaceNames?.has(id)) return workspaceNames.get(id)!;
    if (workspaceName) return workspaceName(id);
    return t("documents.share.workspace_unknown");
  };

  const formatSourceOrigin = (src: Pick<DocumentAccessSource, "via" | "principal_type" | "principal_id">) => {
    if (src.principal_type === "workspace" || src.via === "member") {
      const wsName =
        (src.principal_id && workspaceNames?.get(src.principal_id)) ||
        (homeWorkspace && (!src.principal_id || src.principal_id === homeWorkspace.workspace_id) ? homeWorkspace.workspace_name : "");
      return wsName ? t("documents.share.via_workspace_named", { name: wsName }) : t("documents.share.via_member");
    }
    if (src.principal_type === "organization" || String(src.via) === "organization") {
      return organization?.name ? t("documents.share.via_organization_named", { name: organization.name }) : t("documents.share.via_organization");
    }
    return viaLabel(src.via);
  };

  const resolvePrincipalName = (principalType: string, principalId: string): string | null => {
    if (principalType === "user") return resolveMemberName(principalId);
    if (principalType === "workspace") return resolveWsName(principalId);
    if (principalType === "organization") return organization?.name || t("documents.share.principal_organization");
    return principalId;
  };

  const homeShareFallback = useMemo(
    () => rawShares.find((s) => s.active && s.principal_type === "workspace" && homeWsId !== "" && s.principal_id === homeWsId),
    [rawShares, homeWsId],
  );
  const homeRow = useMemo(() => {
    if (homeWorkspace && homeWorkspace.level !== null) {
      return {
        workspace_id: homeWorkspace.workspace_id,
        workspace_name: homeWorkspace.workspace_name || workspaceNames?.get(homeWorkspace.workspace_id) || "",
        level: homeWorkspace.level,
      };
    }
    if (homeShareFallback) {
      return {
        workspace_id: homeShareFallback.principal_id,
        workspace_name: homeWorkspace?.workspace_name || workspaceNames?.get(homeShareFallback.principal_id) || "",
        level: homeShareFallback.level,
      };
    }
    return null;
  }, [homeWorkspace, homeShareFallback, workspaceNames]);

  const orderedShares = useMemo(
    () => [
      ...rawShares.filter((s) => s.principal_type === "user"),
      ...rawShares.filter((s) => s.principal_type === "workspace" && (!s.active || homeWsId === "" || s.principal_id !== homeWsId)),
      ...rawShares.filter((s) => s.principal_type === "organization"),
    ],
    [rawShares, homeWsId],
  );

  const totalRowCount = (aclOwner ? 1 : 0) + (homeRow ? 1 : 0) + orderedShares.length;
  const filterVisible = totalRowCount > FILTER_THRESHOLD;
  // A filter typed while the box showed must not keep hiding rows once the box
  // is gone (rows revoked down to the threshold): it stops applying and resets.
  const filterNeedle = filterVisible ? foldSearchText(filterQuery) : "";
  useEffect(() => {
    if (!filterVisible) setFilterQuery("");
  }, [filterVisible]);
  const matchesFilter = (label: string) => !filterNeedle || foldSearchText(label).includes(filterNeedle);

  if (!canManage && !adminScope) {
    const mySources = access?.my_sources ?? [];
    return (
      <section aria-labelledby="share-access-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 id="share-access-title" className="text-label font-medium text-foreground">{t("documents.share.access_title")}</h3>
          {myLevel ? <span className="text-caption text-muted-foreground">{t("documents.share.my_level", { level: levelLabel(myLevel) })}</span> : null}
        </div>
        {mySources.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-lg border border-border p-3 text-caption text-muted-foreground">
            {mySources.map((src, idx) => (
              <li key={`${src.via}-${src.principal_id ?? idx}`}>
                {t("documents.share.source_item", { level: levelLabel(src.level), source: formatSourceOrigin(src) })}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground">{t("documents.share.manage_only")}</p>
      </section>
    );
  }

  const sentenceDeps = { t, levelLabel, sourceLabel: (via: string) => formatSourceOrigin({ via: via as DocumentAccessVia }) };

  const buildConfirmSentence = (
    item: DocumentAccessUpdateItemInput, name: string, beforeLevel: DocumentAccessLevel, preview: DocumentAccessPreview,
  ): PreviewSentence | null => {
    const user = preview.users.find((x) => x.user_id === item.principal_id);
    const group = preview.groups.find((x) => x.principal_type === item.principal_type && x.principal_id === item.principal_id);
    if (item.level === null) return revokeSentence(sentenceDeps, { name, principalType: item.principal_type, user, group });
    const w = preview.warnings[0];
    if (!w) return null;
    return warningSentence(sentenceDeps, {
      code: w.code, name, principalType: item.principal_type, targetLevel: item.level, beforeLevel, user, group,
    });
  };

  const commitRowChange = async (item: DocumentAccessUpdateItemInput, done: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setActionError(null);
    try {
      await updateAccess.mutateAsync({ items: [item], dry_run: false });
      setPendingConfirm(null);
      toast.success(done);
    } catch (err) {
      setActionError(shareErrorMessage(err, t) ?? (item.level === null ? t("documents.share.revoke_failed") : t("documents.share.submit_failed")));
    } finally {
      inFlight.current = false;
    }
  };

  const requestRowChange = async (
    rowKey: string, principalType: DocumentPrincipalType, principalId: string,
    name: string, beforeLevel: DocumentAccessLevel, nextLevel: DocumentAccessLevel | null,
  ) => {
    if (updateAccess.isPending || inFlight.current) return;
    inFlight.current = true;
    setActionError(null);
    const item: DocumentAccessUpdateItemInput = {
      principal_type: principalType, principal_id: principalId, level: nextLevel,
      ...(nextLevel !== null ? { on_existing: "update" as const } : {}),
    };
    let sentence: PreviewSentence | null;
    try {
      const dryRun = await updateAccess.mutateAsync({ items: [item], dry_run: true });
      sentence = buildConfirmSentence(item, name, beforeLevel, dryRun.preview);
    } catch (err) {
      inFlight.current = false;
      setActionError(shareErrorMessage(err, t) ?? (nextLevel === null ? t("documents.share.revoke_failed") : t("documents.share.submit_failed")));
      return;
    }
    inFlight.current = false;
    if (sentence) {
      setPendingConfirm({ rowKey, name, item, sentence });
      return;
    }
    await commitRowChange(item, t("documents.share.updated_toast", { name, level: levelLabel(item.level ?? "view") }));
  };

  const renderDirectBelowGroupWarning = (share: DocumentShare, personName: string) => {
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
        {t("documents.share.warning_direct_below_group", { name: personName, effectiveLevel, source })}
      </p>
    );
  };

  const hasAnyRow = Boolean(aclOwner || homeRow || orderedShares.length > 0);
  const homeDisplayLabel = homeRow
    ? homeRow.workspace_name ? `${t("documents.share.principal_workspace")} ${homeRow.workspace_name}` : t("documents.share.principal_workspace")
    : "";

  return (
    <section aria-labelledby="share-access-title" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="share-access-title" className="text-label font-medium text-foreground">{t("documents.share.access_title")}</h3>
        {myLevel ? <span className="text-caption text-muted-foreground">{t("documents.share.my_level", { level: levelLabel(myLevel) })}</span> : null}
      </div>

      {filterVisible ? (
        <Input
          aria-label={t("documents.share.access_filter_label")}
          placeholder={t("documents.share.access_filter_placeholder")}
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
      ) : null}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {aclOwner && matchesFilter(resolveMemberName(aclOwner.user_id) ?? "") ? (
          <li className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2">
            <span className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-body text-foreground">
              <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <NameOrSkeleton name={resolveMemberName(aclOwner.user_id)} />
              <span className="shrink-0 text-caption text-muted-foreground">{t("documents.share.acl_owner")}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-caption text-muted-foreground">
              {doc && orgMembers ? (
                <OwnerTransferAction
                  wsId={wsId}
                  doc={doc}
                  ownerId={aclOwner.user_id}
                  ownerName={resolveMemberName(aclOwner.user_id) ?? t("documents.share.person_unknown")}
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
        ) : null}

        {homeRow && matchesFilter(homeRow.workspace_name) ? (
          <li className="flex flex-col gap-1.5 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
                <FolderKanban aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{homeDisplayLabel}</span>
                <Badge variant="secondary">{t("documents.share.home_badge")}</Badge>
              </span>
              {canManage ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-32">
                    <Select
                      value={homeRow.level}
                      items={allowedLevelsForPrincipal("workspace", true).map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))}
                      onValueChange={(v) =>
                        void requestRowChange(`home:${homeRow.workspace_id}`, "workspace", homeRow.workspace_id, homeDisplayLabel, homeRow.level, v as DocumentAccessLevel)
                      }
                    >
                      <SelectTrigger aria-label={`${t("documents.share.level_label")} ${homeRow.workspace_name || t("documents.share.principal_workspace")}`}>
                        <SelectValue>{`${t("documents.share.level_label")}: ${levelLabel(homeRow.level)}`}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {allowedLevelsForPrincipal("workspace", true).map((lvl) => (
                          <SelectItem key={lvl} value={lvl}>{levelLabel(lvl)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button" variant="ghost" size="sm" disabled={updateAccess.isPending}
                    aria-label={`${t("documents.share.revoke")} ${homeDisplayLabel}`}
                    onClick={() => void requestRowChange(`home:${homeRow.workspace_id}`, "workspace", homeRow.workspace_id, homeDisplayLabel, homeRow.level, null)}
                  >
                    {t("documents.share.revoke")}
                  </Button>
                </div>
              ) : (
                <Badge variant="outline">{levelLabel(homeRow.level)}</Badge>
              )}
            </div>
          </li>
        ) : null}

        {orderedShares.map((share) => {
          const label = resolvePrincipalName(share.principal_type, share.principal_id);
          if (!matchesFilter(label ?? "")) return null;
          const displayLabel = label ?? t("documents.share.person_unknown");
          const rowKey = `share:${share.id || `${share.principal_type}:${share.principal_id}`}`;
          const allowedLevels = allowedLevelsForPrincipal(share.principal_type, false);
          const sources = share.sources ?? [];
          const isSourcesOpen = Boolean(expandedSources[rowKey]);
          return (
            <li key={rowKey} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
                    {share.principal_type === "user" ? (
                      <UserRound aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : share.principal_type === "workspace" ? (
                      <Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Users aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
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
                      type="button" aria-expanded={isSourcesOpen}
                      className="mt-0.5 pl-5.5 text-left text-caption text-muted-foreground underline hover:text-foreground"
                      onClick={() => setExpandedSources((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))}
                    >
                      {t("documents.share.sources_toggle", { count: sources.length })}
                    </button>
                  ) : null}
                </div>

                {canManage ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <div className="w-32">
                      <Select
                        value={share.level}
                        disabled={!share.active}
                        items={allowedLevels.map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))}
                        onValueChange={(v) =>
                          void requestRowChange(rowKey, share.principal_type as DocumentPrincipalType, share.principal_id, displayLabel, share.level, v as DocumentAccessLevel)
                        }
                      >
                        <SelectTrigger aria-label={`${t("documents.share.level_label")} ${displayLabel}`}>
                          <SelectValue>{`${t("documents.share.level_label")}: ${levelLabel(share.level)}`}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {allowedLevels.map((lvl) => (
                            <SelectItem key={lvl} value={lvl}>{levelLabel(lvl)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button" variant="ghost" size="sm" disabled={updateAccess.isPending}
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

              {renderDirectBelowGroupWarning(share, displayLabel)}

              {isSourcesOpen && sources.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-caption text-muted-foreground">
                  {sources.map((src, idx) => (
                    <li key={`${src.via}-${src.principal_id ?? idx}`}>
                      {t("documents.share.source_item", { level: levelLabel(src.level), source: formatSourceOrigin(src) })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}

        {!hasAnyRow ? <li className="px-3 py-2 text-caption text-muted-foreground">{t("documents.share.no_grants")}</li> : null}
      </ul>

      {pendingConfirm ? (
        <div
          role="region"
          data-testid="share-access-confirm"
          className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-caption text-foreground"
        >
          <p>{pendingConfirm.sentence.confirm}</p>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={updateAccess.isPending} onClick={() => void commitRowChange(pendingConfirm.item, pendingConfirm.sentence.done)}>
              {updateAccess.isPending ? <Spinner aria-hidden role="presentation" /> : null}
              {t("documents.share.confirm_accept")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={updateAccess.isPending} onClick={() => setPendingConfirm(null)}>
              {t("documents.share.confirm_cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {actionError ? <p role="alert" className="text-caption text-destructive">{actionError}</p> : null}
    </section>
  );
}
