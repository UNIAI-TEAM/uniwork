"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { DocumentAccessPreview, DocumentAccessUpdateItemInput, DocumentPrincipalType } from "@uniwork/core/api/endpoints/documents-sharing";
import { useUpdateDocumentAccess } from "@uniwork/core/documents/hooks-sharing";
import type { DocumentAccess, DocumentAccessLevel, DocumentAccessSource, DocumentAccessVia, DocumentShare } from "@uniwork/core/types/document";
import type { OrgMember } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { foldSearchText } from "./share-candidate-picker";
import { shareErrorMessage } from "./share-dialog-break-glass";
import type { ShareDialogTarget } from "./share-dialog-target";
import { AclOwnerRow, HomeWorkspaceRow, ShareRow, levelRank, type ShareAccessHomeRow, type ShareAccessRowContext } from "./share-access-rows";
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
  /** The document is shelved (ARCHIVE-01 U-9): access can only be taken away —
   *  revoke and a level LOWERING stay enabled; a raise, an owner transfer and
   *  turning the home row on are off. */
  shelved?: boolean;
  /** The explanation line the locked controls point at. */
  shelvedNoteId?: string;
}

interface PendingRowConfirm {
  rowKey: string;
  name: string;
  item: DocumentAccessUpdateItemInput;
  sentence: PreviewSentence;
  /** The control that opened the panel takes its focus back when it closes (R4-02). */
  opener: "revoke" | "level";
}

const FILTER_THRESHOLD = 20;

export function ShareAccessList({
  wsId, docId, docWorkspaceId, doc, access, canManage,
  adminScope = false, canTransfer = false, ownedByWorkProduct = false, onOpenTransfer,
  memberName, memberLabels, workspaceName, workspaceNames, organization, orgMembers,
  shelved = false, shelvedNoteId,
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
  const confirmRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // `${opener}:${rowKey}` → the control that opened the confirm panel, so
  // closing it returns focus there (R4-02); callback refs keep it fresh.
  const openerEls = useRef(new Map<string, HTMLElement>());
  const prevConfirmRef = useRef<PendingRowConfirm | null>(null);
  // Cancel/Accept both close the panel; the close effect reads which it was.
  const confirmOutcome = useRef<"accept" | "cancel" | null>(null);

  // A revoke/downgrade click on a row near the top must not leave its confirm
  // panel off-screen at the list's end (TV1-04): the panel renders inside the
  // row it belongs to, scrolls into view and takes focus.
  useEffect(() => {
    const prev = prevConfirmRef.current;
    prevConfirmRef.current = pendingConfirm;
    if (pendingConfirm) {
      confirmRef.current?.scrollIntoView?.({ block: "nearest" });
      confirmRef.current?.focus();
      return;
    }
    // R4-02: closing the panel unmounts the element focus was in; a keyboard
    // user who did not land on the heading gets the control back that opened
    // it — an accepted revoke removes that row, so it lands on the heading.
    if (!prev || document.activeElement === headingRef.current) return;
    const outcome = confirmOutcome.current ?? "cancel";
    confirmOutcome.current = null;
    const target =
      outcome === "accept" && prev.item.level === null
        ? null
        : openerEls.current.get(`${prev.opener}:${prev.rowKey}`) ?? null;
    ((target?.isConnected ? target : null) ?? headingRef.current)?.focus();
  }, [pendingConfirm]);

  useEffect(() => {
    if (!actionError) return;
    errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [actionError]);

  // A level the server knows and the client does not narrows to null (or stays
  // an unknown string): it is "Mức khác", never "Chỉ xem" (R3-02).
  const levelLabel = (lvl: DocumentAccessLevel | string | null | undefined) =>
    lvl === "manage" ? t("documents.share.level_manage")
    : lvl === "edit" ? t("documents.share.level_edit")
    : lvl === "comment" ? t("documents.share.level_comment")
    : lvl === "view" ? t("documents.share.level_view")
    : t("documents.share.level_other");

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
  const homeRow = useMemo((): ShareAccessHomeRow | null => {
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

  // R5-01: a manager who drops their own Manage keeps the ref on the heading
  // the close effect focuses, whichever variant this branch renders.
  if (!canManage && !adminScope) {
    const mySources = access?.my_sources ?? [];
    return (
      <section aria-labelledby="share-access-title" className="flex min-w-0 flex-col gap-2">
        <h3 id="share-access-title" ref={headingRef} tabIndex={-1} className="text-label font-medium text-foreground outline-none focus-visible:underline">
          {myLevel ? t("documents.share.my_level", { level: levelLabel(myLevel) }) : t("documents.share.access_title")}
        </h3>
        {mySources.length > 0 ? (
          <ul className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-caption text-muted-foreground">
            {mySources.map((src, idx) => (
              <li key={`${src.via}-${src.principal_id ?? idx}`} className="break-words">
                {t("documents.share.source_item", { level: levelLabel(src.level), source: formatSourceOrigin(src) })}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-caption text-muted-foreground">{t("documents.share.manage_only")}</p>
      </section>
    );
  }

  const sentenceDeps = { t, levelLabel, sourceLabel: (via: string) => formatSourceOrigin({ via: via as DocumentAccessVia }) };

  const buildConfirmSentence = (
    item: DocumentAccessUpdateItemInput, name: string, beforeLevel: DocumentAccessLevel | null, preview: DocumentAccessPreview,
  ): PreviewSentence | null => {
    const user = preview.users.find((x) => x.user_id === item.principal_id);
    const group = preview.groups.find((x) => x.principal_type === item.principal_type && x.principal_id === item.principal_id);
    if (item.level === null) return revokeSentence(sentenceDeps, { name, principalType: item.principal_type, user, group });
    const w = preview.warnings[0];
    if (!w) return null;
    return warningSentence(sentenceDeps, {
      code: w.code, name, principalType: item.principal_type, targetLevel: item.level, beforeLevel: beforeLevel ?? undefined, user, group,
    });
  };

  const setOpenerEl = (opener: "revoke" | "level", rowKey: string, el: HTMLElement | null) => {
    const key = `${opener}:${rowKey}`;
    if (el) openerEls.current.set(key, el);
    else openerEls.current.delete(key);
  };

  const commitRowChange = async (item: DocumentAccessUpdateItemInput, done: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setActionError(null);
    try {
      await updateAccess.mutateAsync({ items: [item], dry_run: false });
      confirmOutcome.current = "accept";
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
    name: string, beforeLevel: DocumentAccessLevel | null, nextLevel: DocumentAccessLevel | null,
  ) => {
    // ARCHIVE-01 U-9: a shelved document only lets access be taken away —
    // revoke (null) and a lowering pass; a raise or a first grant is blocked.
    if (shelved && nextLevel !== null && levelRank(nextLevel) > levelRank(beforeLevel)) return;
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
      confirmOutcome.current = "cancel";
      setPendingConfirm({ rowKey, name, item, sentence, opener: nextLevel === null ? "revoke" : "level" });
      return;
    }
    await commitRowChange(item, t("documents.share.updated_toast", { name, level: levelLabel(item.level ?? "view") }));
  };

  const ctx: ShareAccessRowContext = {
    wsId, doc, canManage, canTransfer, ownedByWorkProduct,
    updatePending: updateAccess.isPending, onOpenTransfer, orgMembers, shelved, shelvedNoteId,
    t, levelLabel, viaLabel, resolveMemberName, formatSourceOrigin, setOpenerEl,
    requestRowChange,
  };

  const hasAnyRow = Boolean(aclOwner || homeRow || orderedShares.length > 0);
  const homeDisplayLabel = homeRow
    ? homeRow.workspace_name ? `${t("documents.share.principal_workspace")} ${homeRow.workspace_name}` : t("documents.share.principal_workspace")
    : "";
  const homeRowKey = homeRow ? `home:${homeRow.workspace_id}` : "";
  const visibleShares = orderedShares.filter((share) => {
    const label = resolvePrincipalName(share.principal_type, share.principal_id);
    return matchesFilter(label ?? "");
  });
  // The confirm panel lives inside the row it came from (TV1-04); when that
  // row is not rendered (filtered out, or the share gone after a re-fetch)
  // the panel falls back to the bottom of the list rather than disappearing.
  const confirmInRow = Boolean(
    pendingConfirm &&
      ((homeRow && pendingConfirm.rowKey === homeRowKey && matchesFilter(homeRow.workspace_name)) ||
        visibleShares.some(
          (share) => pendingConfirm.rowKey === `share:${share.id || `${share.principal_type}:${share.principal_id}`}`,
        )),
  );

  const confirmPanel = pendingConfirm ? (
    <div
      ref={confirmRef}
      role="region"
      data-testid="share-access-confirm"
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-caption break-words text-foreground outline-none"
    >
      <p>{pendingConfirm.sentence.confirm}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={updateAccess.isPending} onClick={() => void commitRowChange(pendingConfirm.item, pendingConfirm.sentence.done)}>
          {updateAccess.isPending ? <Spinner aria-hidden role="presentation" /> : null}
          {t("documents.share.confirm_accept")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={updateAccess.isPending} onClick={() => { confirmOutcome.current = "cancel"; setPendingConfirm(null); }}>
          {t("documents.share.confirm_cancel")}
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <section aria-labelledby="share-access-title" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="share-access-title" ref={headingRef} tabIndex={-1} className="text-label font-medium text-foreground outline-none focus-visible:underline">{t("documents.share.access_title")}</h3>
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
          <AclOwnerRow owner={aclOwner} ctx={ctx} />
        ) : null}

        {homeRow && matchesFilter(homeRow.workspace_name) ? (
          <HomeWorkspaceRow
            homeRow={homeRow}
            homeRowKey={homeRowKey}
            homeDisplayLabel={homeDisplayLabel}
            ctx={ctx}
            confirmPanel={pendingConfirm?.rowKey === homeRowKey ? confirmPanel : null}
          />
        ) : null}

        {visibleShares.map((share) => {
          const label = resolvePrincipalName(share.principal_type, share.principal_id);
          const displayLabel = label ?? t("documents.share.person_unknown");
          const rowKey = `share:${share.id || `${share.principal_type}:${share.principal_id}`}`;
          const isSourcesOpen = Boolean(expandedSources[rowKey]);
          return (
            <ShareRow
              key={rowKey}
              share={share}
              rowKey={rowKey}
              displayLabel={displayLabel}
              label={label}
              ctx={ctx}
              expanded={isSourcesOpen}
              onToggleSources={() => setExpandedSources((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))}
              confirmPanel={pendingConfirm?.rowKey === rowKey ? confirmPanel : null}
            />
          );
        })}

        {!hasAnyRow ? <li className="px-3 py-2 text-caption text-muted-foreground">{t("documents.share.no_grants")}</li> : null}
      </ul>

      {pendingConfirm && !confirmInRow ? confirmPanel : null}

      {actionError ? <p ref={errorRef} role="alert" className="text-caption break-words text-destructive">{actionError}</p> : null}
    </section>
  );
}
