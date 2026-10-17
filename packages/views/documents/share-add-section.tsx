"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  parseDocumentAccessRejected,
  type DocumentAccessOnExisting,
  type DocumentAccessPreview,
  type DocumentAccessRejectedCode,
  type DocumentAccessUpdateItemInput,
  type DocumentShareCandidate,
} from "@uniwork/core/api/endpoints/documents-sharing";
import {
  classifyDocumentError,
  sharePrincipalsNotInOrganization,
} from "@uniwork/core/documents/errors";
import {
  useDocumentShareCandidates,
  useUpdateDocumentAccess,
} from "@uniwork/core/documents/hooks-sharing";
import {
  DOCUMENT_ACCESS_LEVELS,
  type Document,
  type DocumentAccessLevel,
  type DocumentAccessVia,
  type DocumentHomeWorkspaceAccess,
  type DocumentShare,
} from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import {
  foldSearchText,
  resolveShareCandidates,
  ShareCandidatePicker,
  type ShareMembersDirectory,
} from "./share-candidate-picker";
import { shareErrorMessage } from "./share-dialog-break-glass";
import { SHARE_PEOPLE_MAX } from "./share-people-picker";

export type { ShareMembersDirectory };

export interface SelectedShareCandidate {
  key: string;
  candidate: DocumentShareCandidate;
  customLevel?: DocumentAccessLevel;
  onExisting: DocumentAccessOnExisting;
}

export interface ShareAddSectionProps {
  wsId: string;
  doc: Pick<Document, "id" | "workspace_id" | "organization_id">;
  open: boolean;
  shares: DocumentShare[];
  homeWorkspace?: DocumentHomeWorkspaceAccess | null;
  alreadySharedUserIds?: readonly (string | null | undefined)[];
  members: ShareMembersDirectory;
  orgWorkspaces: Array<{ id: string; name: string }>;
  organization?: { id: string; name: string } | null;
  onSelfShareBlocked?: (message: string) => void;
}

export function allowedLevelsForPrincipal(
  principalType: string,
  isHomeWorkspace = false,
): readonly DocumentAccessLevel[] {
  if (principalType === "organization" || (principalType === "workspace" && isHomeWorkspace)) {
    return ["view", "comment", "edit"] as const;
  }
  return DOCUMENT_ACCESS_LEVELS;
}

export function ShareAddSection({
  wsId,
  doc,
  open,
  shares,
  homeWorkspace,
  alreadySharedUserIds,
  members,
  orgWorkspaces,
  organization,
  onSelfShareBlocked,
}: ShareAddSectionProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const inputId = `${baseId}-candidate-input`;
  const listboxId = `${baseId}-candidate-listbox`;
  const levelId = `${baseId}-common-level`;

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<SelectedShareCandidate[]>([]);
  const [commonLevel, setCommonLevel] = useState<DocumentAccessLevel>("view");
  const [customMode, setCustomMode] = useState(false);
  const [pendingApplyAllLevel, setPendingApplyAllLevel] = useState<DocumentAccessLevel | null>(null);
  const [pendingPreview, setPendingPreview] = useState<{
    items: DocumentAccessUpdateItemInput[];
    preview: DocumentAccessPreview;
  } | null>(null);
  const [rejectedByKey, setRejectedByKey] = useState<Record<string, DocumentAccessRejectedCode>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setDebouncedQuery("");
      return;
    }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery(""); setDebouncedQuery(""); setSelected([]); setCommonLevel("view");
      setCustomMode(false); setPendingApplyAllLevel(null); setPendingPreview(null);
      setRejectedByKey({}); setSubmitError(null); setAnnouncement("");
    }
  }, [open, doc.id]);

  const candidatesQuery = useDocumentShareCandidates(wsId, doc.id, { q: debouncedQuery, enabled: open });
  const updateAccess = useUpdateDocumentAccess(wsId, doc.id);

  const levelLabel = (lvl: DocumentAccessLevel | string) =>
    lvl === "manage" ? t("documents.share.level_manage")
    : lvl === "edit" ? t("documents.share.level_edit")
    : lvl === "comment" ? t("documents.share.level_comment")
    : t("documents.share.level_view");

  const viaLabel = (via: DocumentAccessVia | string) =>
    via === "owner" ? t("documents.share.via_owner")
    : via === "member" ? t("documents.share.via_member")
    : via === "organization" ? t("documents.share.via_organization")
    : via === "link" ? t("documents.share.via_link")
    : via === "ai_context" ? t("documents.share.via_ai_context")
    : t("documents.share.via_share");

  const rejectedReasonLabel = (code: DocumentAccessRejectedCode) =>
    code === "principal_not_in_organization" ? t("documents.share.rejected_not_in_org")
    : code === "level_not_allowed" ? t("documents.share.rejected_level_not_allowed")
    : code === "duplicate_principal" ? t("documents.share.rejected_duplicate")
    : t("documents.share.rejected_break_glass");

  const allCandidates = useMemo(
    () =>
      resolveShareCandidates(
        candidatesQuery.data?.items ?? [],
        shares,
        homeWorkspace,
        doc.workspace_id,
        members,
        orgWorkspaces,
        organization,
      ),
    [candidatesQuery.data?.items, shares, homeWorkspace, doc.workspace_id, members, orgWorkspaces, organization],
  );

  const filteredCandidates = useMemo(() => {
    const needle = foldSearchText(query);
    if (!needle) return allCandidates;
    return allCandidates.filter(
      (c) => foldSearchText(c.name).includes(needle) || foldSearchText(c.secondary).includes(needle),
    );
  }, [allCandidates, query]);

  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.key)), [selected]);
  const atLimit = selected.length >= SHARE_PEOPLE_MAX;

  const effectiveItemLevel = (item: SelectedShareCandidate): DocumentAccessLevel => {
    const desired = item.customLevel ?? commonLevel;
    const allowed = allowedLevelsForPrincipal(item.candidate.principal_type, item.candidate.is_home_workspace);
    return allowed.includes(desired) ? desired : "edit";
  };

  const hasCustomOverrides = useMemo(
    () => selected.some((s) => s.customLevel !== undefined && s.customLevel !== commonLevel),
    [selected, commonLevel],
  );

  const customLevelsSummaryText = (() => {
    if (!selected.length) return "";
    const counts = new Map<DocumentAccessLevel, number>();
    for (const item of selected) {
      const lvl = effectiveItemLevel(item);
      counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
    }
    return DOCUMENT_ACCESS_LEVELS.filter((lvl) => (counts.get(lvl) ?? 0) > 0)
      .map((lvl) => `${counts.get(lvl)} ${levelLabel(lvl)}`)
      .join(" · ");
  })();

  const selectCandidate = (candidate: DocumentShareCandidate) => {
    const key = `${candidate.principal_type}:${candidate.principal_id}`;
    if (selectedKeys.has(key) || atLimit) return;
    setSelected((prev) => [...prev, { key, candidate, onExisting: "keep" }]);
    setQuery("");
    setPendingPreview(null);
    setSubmitError(null);
  };

  const removeCandidate = (key: string, name: string) => {
    setSelected((prev) => prev.filter((item) => item.key !== key));
    setRejectedByKey((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPendingPreview(null);
    setAnnouncement(t("documents.share.people_removed", { name }));
  };

  const confirmApplyAll = (targetLevel: DocumentAccessLevel) => {
    setCommonLevel(targetLevel);
    setSelected((prev) => prev.map((item) => ({ ...item, customLevel: undefined })));
    setPendingApplyAllLevel(null);
    setPendingPreview(null);
  };

  const buildRequestItems = (): DocumentAccessUpdateItemInput[] =>
    selected.map((item) => {
      const entry: DocumentAccessUpdateItemInput = {
        principal_type: item.candidate.principal_type,
        principal_id: item.candidate.principal_id,
        level: effectiveItemLevel(item),
      };
      if (item.candidate.direct_level !== null) entry.on_existing = item.onExisting;
      return entry;
    });

  const handleMutationError = (err: unknown, items: DocumentAccessUpdateItemInput[]) => {
    const rejected = parseDocumentAccessRejected(err);
    if (rejected && rejected.rejected.length > 0) {
      const nextMap: Record<string, DocumentAccessRejectedCode> = {};
      for (const r of rejected.rejected) {
        const item = items[r.index];
        const key = item ? `${item.principal_type}:${item.principal_id}` : `${r.principal_type}:${r.principal_id}`;
        nextMap[key] = r.code;
      }
      setRejectedByKey(nextMap);
      setSubmitError(
        rejected.rejected
          .map((r) => {
            const match = selected.find(
              (s) => s.candidate.principal_type === r.principal_type && s.candidate.principal_id === r.principal_id,
            );
            return `${match?.candidate.name ?? r.principal_id}: ${rejectedReasonLabel(r.code)}`;
          })
          .join(" · "),
      );
      return;
    }
    const refused = sharePrincipalsNotInOrganization(err);
    if (refused?.length) {
      const names = refused
        .map((id) => selected.find((s) => s.candidate.principal_id === id)?.candidate.name ?? id)
        .join(", ");
      setSubmitError(t("documents.share.people_not_in_org", { count: refused.length, names }));
      return;
    }
    const cls = classifyDocumentError(err);
    const msg = shareErrorMessage(err, t) ?? t("documents.share.submit_failed");
    setSubmitError(msg);
    if (cls.code === "break_glass_required") onSelfShareBlocked?.(msg);
  };

  const executeCommit = async (items: DocumentAccessUpdateItemInput[]) => {
    setSubmitError(null);
    setRejectedByKey({});
    try {
      await updateAccess.mutateAsync({ items, dry_run: false });
      toast.success(t("documents.share.shared_toast", { count: items.length }));
      setSelected([]);
      setQuery("");
      setCustomMode(false);
      setPendingPreview(null);
    } catch (err) {
      handleMutationError(err, items);
    }
  };

  const handleSubmit = async () => {
    if (!selected.length || updateAccess.isPending) return;
    setSubmitError(null);
    setRejectedByKey({});
    const items = buildRequestItems();
    try {
      const dryRunResult = await updateAccess.mutateAsync({ items, dry_run: true });
      if (dryRunResult.preview.warnings.length > 0) {
        setPendingPreview({ items, preview: dryRunResult.preview });
        return;
      }
      await executeCommit(items);
    } catch (err) {
      handleMutationError(err, items);
    }
  };

  const renderWarningSentence = (warning: { code: string; index: number }) => {
    const item = selected[warning.index];
    const name = item?.candidate.name ?? "";
    const targetLevel = item ? levelLabel(effectiveItemLevel(item)) : levelLabel(commonLevel);
    if (warning.code === "wide_scope") {
      const group = pendingPreview?.preview.groups.find(
        (g) => g.principal_type === item?.candidate.principal_type && g.principal_id === item?.candidate.principal_id,
      );
      const count = group?.member_count ?? 0;
      return item?.candidate.principal_type === "organization"
        ? t("documents.share.warning_wide_scope_organization", { name, count, level: targetLevel })
        : t("documents.share.warning_wide_scope_workspace", { name, count, level: targetLevel });
    }
    if (warning.code === "direct_below_group") {
      const userPreview = pendingPreview?.preview.users.find((u) => u.user_id === item?.candidate.principal_id);
      const effectiveLevel = levelLabel(userPreview?.after.level || "edit");
      const source = viaLabel(userPreview?.after.via || "member");
      return t("documents.share.warning_direct_below_group", { name, effectiveLevel, source });
    }
    const userPreview = pendingPreview?.preview.users.find((u) => u.user_id === item?.candidate.principal_id);
    const before = levelLabel(userPreview?.before.level || item?.candidate.direct_level || "edit");
    return t("documents.share.warning_downgrade_person", { name, before, after: targetLevel });
  };

  return (
    <section aria-labelledby="share-add-title" className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="share-add-title" className="text-label font-medium text-foreground">
          {t("documents.share.add_title")}
        </h3>
        {selected.length > 0 ? (
          <span className="text-caption text-muted-foreground">
            {t("documents.share.selected_count", { count: selected.length })}
          </span>
        ) : null}
      </div>

      <span className="sr-only" aria-live="polite">{announcement}</span>

      <ShareCandidatePicker
        inputId={inputId} listboxId={listboxId} query={query} onQueryChange={setQuery}
        selected={selected} selectedKeys={selectedKeys} filteredCandidates={filteredCandidates}
        alreadySharedUserIds={alreadySharedUserIds}
        isLoading={candidatesQuery.isLoading || Boolean(members.loading || members.isLoading)}
        disabled={updateAccess.isPending} atLimit={atLimit} rejectedByKey={rejectedByKey}
        onSelectCandidate={selectCandidate} onRemoveCandidate={removeCandidate}
        onChangeOnExisting={(key, onExisting) =>
          setSelected((prev) => prev.map((s) => (s.key === key ? { ...s, onExisting } : s)))
        }
        effectiveItemLevel={effectiveItemLevel} levelLabel={levelLabel} rejectedReasonLabel={rejectedReasonLabel}
      />

      <p className="text-caption text-muted-foreground">
        {atLimit
          ? t("documents.share.people_limit", { max: SHARE_PEOPLE_MAX })
          : t("documents.share.people_selected", { count: selected.length })}
      </p>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex w-40 flex-col gap-1.5">
            <Label htmlFor={levelId}>{t("documents.share.level_label")}</Label>
            <Select
              value={commonLevel}
              items={DOCUMENT_ACCESS_LEVELS.map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))}
              onValueChange={(v) => {
                const next = v as DocumentAccessLevel;
                if (hasCustomOverrides) setPendingApplyAllLevel(next);
                else { setCommonLevel(next); setPendingPreview(null); }
              }}
            >
              <SelectTrigger id={levelId}><SelectValue>{levelLabel(commonLevel)}</SelectValue></SelectTrigger>
              <SelectContent>
                {(selected.length > 0 &&
                selected.every((s) => s.candidate.principal_type === "organization" || s.candidate.is_home_workspace)
                  ? (["view", "comment", "edit"] as const)
                  : DOCUMENT_ACCESS_LEVELS
                ).map((lvl) => (
                  <SelectItem key={lvl} value={lvl}>{levelLabel(lvl)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected.length > 1 ? (
            <Button type="button" variant="outline" size="sm" aria-expanded={customMode} onClick={() => setCustomMode((p) => !p)}>
              {t("documents.share.custom_levels_toggle")}
            </Button>
          ) : null}
        </div>

        <Button
          type="button"
          aria-disabled={!selected.length || updateAccess.isPending || undefined}
          aria-busy={updateAccess.isPending || undefined}
          onClick={() => void handleSubmit()}
        >
          {updateAccess.isPending ? (<><Spinner aria-hidden role="presentation" />{t("documents.share.submitting")}</>) : t("documents.share.submit")}
        </Button>
      </div>

      {pendingApplyAllLevel ? (
        <div
          role="region"
          aria-label={t("documents.share.apply_all_button")}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-caption"
        >
          <span>{t("documents.share.apply_all_confirm", { count: selected.length, level: levelLabel(pendingApplyAllLevel) })}</span>
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" onClick={() => confirmApplyAll(pendingApplyAllLevel)}>{t("documents.share.apply_all_accept")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPendingApplyAllLevel(null)}>{t("documents.share.apply_all_cancel")}</Button>
          </div>
        </div>
      ) : null}

      {customMode && selected.length > 1 ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span role="status" className="text-caption font-medium text-muted-foreground">
              {t("documents.share.custom_levels_summary", { summary: customLevelsSummaryText })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => (hasCustomOverrides ? setPendingApplyAllLevel(commonLevel) : confirmApplyAll(commonLevel))}
            >
              {t("documents.share.apply_all_button")}
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {selected.map((item) => {
              const allowed = allowedLevelsForPrincipal(item.candidate.principal_type, item.candidate.is_home_workspace);
              const currentLvl = effectiveItemLevel(item);
              return (
                <li key={item.key} className="flex items-center justify-between gap-2 py-1.5 text-body">
                  <span className="truncate text-foreground">{item.candidate.name}</span>
                  <div className="w-36 shrink-0">
                    <Select
                      value={currentLvl}
                      items={allowed.map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))}
                      onValueChange={(v) =>
                        setSelected((prev) => prev.map((s) => (s.key === item.key ? { ...s, customLevel: v as DocumentAccessLevel } : s)))
                      }
                    >
                      <SelectTrigger aria-label={`${t("documents.share.level_label")} ${item.candidate.name}`}>
                        <SelectValue>{levelLabel(currentLvl)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {allowed.map((lvl) => (
                          <SelectItem key={lvl} value={lvl}>{levelLabel(lvl)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {pendingPreview ? (
        <div
          role="region"
          data-testid="share-add-confirm"
          className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-caption text-foreground"
        >
          <ul className="flex flex-col gap-1">
            {pendingPreview.preview.warnings.map((w, idx) => (
              <li key={`${w.code}-${w.index}-${idx}`}>{renderWarningSentence(w)}</li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={updateAccess.isPending} onClick={() => void executeCommit(pendingPreview.items)}>
              {t("documents.share.confirm_accept")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={updateAccess.isPending} onClick={() => setPendingPreview(null)}>
              {t("documents.share.confirm_cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {submitError ? <p role="alert" className="text-caption text-destructive">{submitError}</p> : null}
    </section>
  );
}
