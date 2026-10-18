"use client";

import { useRef, useState } from "react";
import { Building2, FolderKanban, User, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  DocumentAccessOnExisting,
  DocumentAccessRejectedCode,
  DocumentPrincipalType,
  DocumentShareCandidate,
} from "@uniwork/core/api/endpoints/documents-sharing";
import type {
  DocumentAccessLevel,
  DocumentHomeWorkspaceAccess,
  DocumentShare,
} from "@uniwork/core/types/document";
import type { OrgMember } from "@uniwork/core/types/people";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import type { SelectedShareCandidate } from "./share-add-section";

export interface ShareMembersDirectory {
  rows: readonly OrgMember[];
  loading?: boolean;
  isLoading?: boolean;
  error?: string | null;
  retry?: () => void;
}

const PRINCIPAL_GROUPS: DocumentPrincipalType[] = ["user", "workspace", "organization"];

/** Type icon shared by candidate options, selected chips and the custom-level
 *  table (TV1-07): the same glyphs the access list uses per principal type. */
export function SharePrincipalIcon({
  principalType,
  className = "size-3.5 shrink-0 text-muted-foreground",
}: {
  principalType: string;
  className?: string;
}) {
  const Icon = principalType === "user" ? User : principalType === "workspace" ? FolderKanban : Building2;
  return <Icon aria-hidden className={className} />;
}

export function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

/**
 * The local directory the picker falls back to when the candidates endpoint is
 * unavailable. It is only a fallback: it cannot know who the server would
 * refuse, so it is never used to answer a request the server did answer.
 */
export function buildLocalShareCandidates(
  shares: DocumentShare[],
  homeWorkspace: DocumentHomeWorkspaceAccess | null | undefined,
  docWorkspaceId: string | undefined,
  members: ShareMembersDirectory,
  orgWorkspaces: Array<{ id: string; name: string }>,
  organization: { id: string; name: string } | null | undefined,
): DocumentShareCandidate[] {
  const directByKey = new Map<string, DocumentAccessLevel>();
  for (const s of shares) {
    // A level a newer server added narrows to null: it is known, not "view".
    if (s.active && s.level) directByKey.set(`${s.principal_type}:${s.principal_id}`, s.level);
  }
  if (homeWorkspace?.workspace_id && homeWorkspace.level) {
    directByKey.set(`workspace:${homeWorkspace.workspace_id}`, homeWorkspace.level);
  }
  const fallback: DocumentShareCandidate[] = [];
  for (const m of members.rows) {
    if (!m.user_id) continue;
    fallback.push({
      principal_type: "user",
      principal_id: m.user_id,
      name: m.display_name?.trim() || m.email?.trim() || m.user_id,
      secondary: m.email?.trim() ?? "",
      direct_level: directByKey.get(`user:${m.user_id}`) ?? null,
      is_home_workspace: false,
    });
  }
  const homeWsId = homeWorkspace?.workspace_id || docWorkspaceId;
  const seenWs = new Set<string>();
  for (const w of orgWorkspaces) {
    seenWs.add(w.id);
    fallback.push({
      principal_type: "workspace",
      principal_id: w.id,
      name: w.name,
      secondary: "",
      direct_level: directByKey.get(`workspace:${w.id}`) ?? null,
      is_home_workspace: w.id === homeWsId,
    });
  }
  if (homeWorkspace?.workspace_id && homeWorkspace.workspace_name && !seenWs.has(homeWorkspace.workspace_id)) {
    fallback.push({
      principal_type: "workspace",
      principal_id: homeWorkspace.workspace_id,
      name: homeWorkspace.workspace_name,
      secondary: "",
      direct_level: directByKey.get(`workspace:${homeWorkspace.workspace_id}`) ?? null,
      is_home_workspace: true,
    });
  }
  if (organization?.id) {
    fallback.push({
      principal_type: "organization",
      principal_id: organization.id,
      name: organization.name,
      secondary: "",
      direct_level: directByKey.get(`organization:${organization.id}`) ?? null,
      is_home_workspace: false,
    });
  }
  return fallback;
}

/** Narrow a locally built directory by the typed query (the server does this for its own answers). */
export function filterShareCandidates(items: DocumentShareCandidate[], query: string): DocumentShareCandidate[] {
  const needle = foldSearchText(query);
  if (!needle) return items;
  return items.filter((c) => foldSearchText(c.name).includes(needle) || foldSearchText(c.secondary).includes(needle));
}

/** Pixels from the bottom of the list at which the next page is requested. */
const LOAD_MORE_THRESHOLD_PX = 48;

export interface ShareCandidatePickerProps {
  inputId: string;
  listboxId: string;
  query: string;
  onQueryChange: (value: string) => void;
  selected: SelectedShareCandidate[];
  selectedKeys: Set<string>;
  /** The candidates to list, in server order. */
  candidates: DocumentShareCandidate[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError?: boolean;
  /** True when the first page failed: there are no candidates at all, so the
   *  "no result" empty state must not stand in for the failure. */
  loadError?: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  alreadySharedUserIds?: readonly (string | null | undefined)[];
  isLoading: boolean;
  disabled: boolean;
  atLimit: boolean;
  rejectedByKey: Record<string, DocumentAccessRejectedCode>;
  onSelectCandidate: (candidate: DocumentShareCandidate) => void;
  onRemoveCandidate: (key: string, displayName: string) => void;
  onChangeOnExisting: (key: string, onExisting: DocumentAccessOnExisting) => void;
  effectiveItemLevel: (item: SelectedShareCandidate) => DocumentAccessLevel;
  levelLabel: (lvl: DocumentAccessLevel | string) => string;
  rejectedReasonLabel: (code: DocumentAccessRejectedCode) => string;
}

export function ShareCandidatePicker({
  inputId,
  listboxId,
  query,
  onQueryChange,
  selected,
  selectedKeys,
  candidates,
  hasMore,
  loadingMore,
  loadMoreError = false,
  loadError,
  onRetry,
  onLoadMore,
  alreadySharedUserIds,
  isLoading,
  disabled,
  atLimit,
  rejectedByKey,
  onSelectCandidate,
  onRemoveCandidate,
  onChangeOnExisting,
  effectiveItemLevel,
  levelLabel,
  rejectedReasonLabel,
}: ShareCandidatePickerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const alreadySharedSet = new Set((alreadySharedUserIds ?? []).filter((id): id is string => Boolean(id)));

  const firstPageFailed = Boolean(loadError && candidates.length === 0);
  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-2 sm:col-span-2"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !containerRef.current?.contains(next)) setDropdownOpen(false);
      }}
    >
      <Label htmlFor={inputId}>{t("documents.share.principal_placeholder")}</Label>

      {selected.length > 0 ? (
        <ul aria-label={t("documents.share.people_chosen")} className="flex flex-wrap gap-1.5">
          {selected.map((item) => {
            const rejectedCode = rejectedByKey[item.key];
            // Name only in the chip; the email moves to the tooltip (TV1-07)
            // and a long name truncates instead of stretching the dialog.
            const chipTitle =
              item.candidate.principal_type === "user" && item.candidate.secondary
                ? `${item.candidate.name} <${item.candidate.secondary}>`
                : item.candidate.name;
            const keepLabel = item.candidate.direct_level
              ? t("documents.share.on_existing_keep", { level: levelLabel(item.candidate.direct_level) })
              : "";
            const updateLabel = t("documents.share.on_existing_update", { level: levelLabel(effectiveItemLevel(item)) });
            return (
              <li
                key={item.key}
                className={
                  rejectedCode
                    ? "inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-destructive bg-destructive/10 px-2 py-1 text-caption text-destructive"
                    : "inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-caption text-foreground"
                }
              >
                <SharePrincipalIcon principalType={item.candidate.principal_type} />
                <span className="max-w-60 truncate" title={chipTitle}>{item.candidate.name}</span>
                {item.candidate.direct_level ? (
                  <Select
                    items={[
                      { value: "keep", label: keepLabel },
                      { value: "update", label: updateLabel },
                    ]}
                    value={item.onExisting}
                    onValueChange={(v) => onChangeOnExisting(item.key, v as DocumentAccessOnExisting)}
                  >
                    <SelectTrigger
                      aria-label={`${item.candidate.name} ${t("documents.share.candidate_has_access", { level: levelLabel(item.candidate.direct_level) })}`}
                      className="h-6 px-1.5 text-caption"
                    >
                      <SelectValue>{item.onExisting === "keep" ? keepLabel : updateLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep">{keepLabel}</SelectItem>
                      <SelectItem value="update">{updateLabel}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                {rejectedCode ? (
                  <span className="font-medium" data-testid={`rejected-reason-${item.candidate.principal_id}`}>
                    {rejectedReasonLabel(rejectedCode)}
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={t("documents.share.people_remove", { name: item.candidate.name })}
                  disabled={disabled}
                  className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onRemoveCandidate(item.key, item.candidate.name)}
                >
                  <X aria-hidden className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="relative">
        <Input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={dropdownOpen && !firstPageFailed}
          aria-controls={firstPageFailed ? undefined : listboxId}
          placeholder={t("documents.share.candidate_search")}
          value={query}
          disabled={disabled || atLimit}
          onFocus={() => setDropdownOpen(true)}
          onClick={() => setDropdownOpen(true)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setDropdownOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && dropdownOpen) {
              event.preventDefault();
              event.stopPropagation();
              setDropdownOpen(false);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setDropdownOpen(true);
              setActiveIndex((i) => (candidates.length ? (i + 1) % candidates.length : 0));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setDropdownOpen(true);
              setActiveIndex((i) =>
                candidates.length ? (i - 1 + candidates.length) % candidates.length : 0,
              );
            } else if (event.key === "Enter" && dropdownOpen && candidates[activeIndex]) {
              event.preventDefault();
              onSelectCandidate(candidates[activeIndex]);
              setDropdownOpen(false);
            }
          }}
        />
        {firstPageFailed ? (
          <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
            <p className="text-caption text-destructive">{t("documents.share.candidates_error")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => onRetry()}>
              {t("documents.share.retry")}
            </Button>
          </div>
        ) : null}

        {dropdownOpen && !firstPageFailed ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label={t("documents.share.principal_placeholder")}
            className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
            onScroll={(event) => {
              const el = event.currentTarget;
              if (hasMore && !loadingMore && el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_THRESHOLD_PX) {
                onLoadMore();
              }
            }}
          >
            {isLoading && candidates.length === 0 ? (
              <div className="flex items-center gap-2 px-2.5 py-2 text-caption text-muted-foreground">
                <Spinner aria-hidden role="presentation" />
                {t("documents.share.people_loading")}
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-2.5 py-2 text-caption text-muted-foreground">
                {t("documents.share.principal_empty")}
              </div>
            ) : (
              PRINCIPAL_GROUPS.map((groupType) => {
                const groupItems = candidates.filter((c) => c.principal_type === groupType);
                if (groupItems.length === 0) return null;
                const groupTitle =
                  groupType === "user"
                    ? t("documents.share.principal_user")
                    : groupType === "workspace"
                      ? t("documents.share.principal_workspace")
                      : t("documents.share.principal_organization");
                return (
                  <div key={groupType} className="py-1">
                    <div className="px-2.5 py-1 text-caption font-medium text-muted-foreground">{groupTitle}</div>
                    {groupItems.map((candidate) => {
                      const key = `${candidate.principal_type}:${candidate.principal_id}`;
                      const isPicked = selectedKeys.has(key);
                      const subtitle =
                        candidate.principal_type === "user"
                          ? candidate.secondary
                          : candidate.principal_type === "workspace"
                            ? t("documents.share.candidate_workspace_sub")
                            : t("documents.share.candidate_organization_sub");
                      return (
                        <div
                          key={key}
                          role="option"
                          tabIndex={-1}
                          aria-selected={isPicked}
                          aria-disabled={isPicked || atLimit || undefined}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            onSelectCandidate(candidate);
                            setDropdownOpen(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectCandidate(candidate);
                              setDropdownOpen(false);
                            }
                          }}
                          className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-body hover:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <SharePrincipalIcon principalType={candidate.principal_type} />
                            <span className="flex min-w-0 flex-col">
                              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                                <span className="min-w-0 truncate" title={candidate.name}>{candidate.name}</span>
                                {candidate.is_home_workspace ? (
                                  <Badge variant="secondary" className="shrink-0">{t("documents.share.home_badge")}</Badge>
                                ) : null}
                              </span>
                              {subtitle ? (
                                <span className="truncate text-caption text-muted-foreground">{subtitle}</span>
                              ) : null}
                            </span>
                          </span>
                          {candidate.direct_level ? (
                            <Badge variant="outline" className="shrink-0">
                              {t("documents.share.candidate_has_access", { level: levelLabel(candidate.direct_level) })}
                            </Badge>
                          ) : candidate.principal_type === "user" && alreadySharedSet.has(candidate.principal_id) ? (
                            <span className="shrink-0 text-caption text-muted-foreground">
                              {t("documents.share.people_already_shared")}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
            {hasMore || loadingMore || loadMoreError ? (
              <div role="presentation" className="flex items-center justify-center gap-2 py-1">
                {loadMoreError && !loadingMore ? (
                  <span className="text-caption text-destructive">{t("documents.share.candidates_error")}</span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-disabled={loadingMore || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (loadingMore) return;
                    onLoadMore();
                    // The retry can steal focus; hand it back so its unmount
                    // after a successful page cannot blur-close the listbox.
                    inputRef.current?.focus();
                  }}
                >
                  {loadingMore ? <Spinner aria-hidden role="presentation" /> : null}
                  {loadingMore
                    ? t("documents.share.people_loading")
                    : loadMoreError
                      ? t("documents.share.retry")
                      : t("documents.share.candidates_more")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
