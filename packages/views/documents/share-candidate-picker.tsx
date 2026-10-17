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

export function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

export function resolveShareCandidates(
  serverItems: DocumentShareCandidate[],
  shares: DocumentShare[],
  homeWorkspace: DocumentHomeWorkspaceAccess | null | undefined,
  docWorkspaceId: string | undefined,
  members: ShareMembersDirectory,
  orgWorkspaces: Array<{ id: string; name: string }>,
  organization: { id: string; name: string } | null | undefined,
): DocumentShareCandidate[] {
  if (serverItems.length > 0) return serverItems;
  const directByKey = new Map<string, DocumentAccessLevel>();
  for (const s of shares) {
    if (s.active) directByKey.set(`${s.principal_type}:${s.principal_id}`, s.level);
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

export interface ShareCandidatePickerProps {
  inputId: string;
  listboxId: string;
  query: string;
  onQueryChange: (value: string) => void;
  selected: SelectedShareCandidate[];
  selectedKeys: Set<string>;
  filteredCandidates: DocumentShareCandidate[];
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
  filteredCandidates,
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const alreadySharedSet = new Set((alreadySharedUserIds ?? []).filter((id): id is string => Boolean(id)));

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
            const chipDisplay =
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
                    ? "inline-flex flex-wrap items-center gap-1.5 rounded-md border border-destructive bg-destructive/10 px-2 py-1 text-caption text-destructive"
                    : "inline-flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-caption text-foreground"
                }
              >
                <span className="max-w-60 truncate">{chipDisplay}</span>
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
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={dropdownOpen}
          aria-controls={listboxId}
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
              setActiveIndex((i) => (filteredCandidates.length ? (i + 1) % filteredCandidates.length : 0));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setDropdownOpen(true);
              setActiveIndex((i) =>
                filteredCandidates.length ? (i - 1 + filteredCandidates.length) % filteredCandidates.length : 0,
              );
            } else if (event.key === "Enter" && dropdownOpen && filteredCandidates[activeIndex]) {
              event.preventDefault();
              onSelectCandidate(filteredCandidates[activeIndex]);
              setDropdownOpen(false);
            }
          }}
        />

        {dropdownOpen ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label={t("documents.share.principal_placeholder")}
            className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {isLoading && filteredCandidates.length === 0 ? (
              <div className="flex items-center gap-2 px-2.5 py-2 text-caption text-muted-foreground">
                <Spinner aria-hidden role="presentation" />
                {t("documents.share.people_loading")}
              </div>
            ) : filteredCandidates.length === 0 ? (
              <div className="px-2.5 py-2 text-caption text-muted-foreground">
                {t("documents.share.principal_empty")}
              </div>
            ) : (
              PRINCIPAL_GROUPS.map((groupType) => {
                const groupItems = filteredCandidates.filter((c) => c.principal_type === groupType);
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
                            {candidate.principal_type === "user" ? (
                              <User aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                            ) : candidate.principal_type === "workspace" ? (
                              <FolderKanban aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="flex min-w-0 flex-col">
                              <span className="flex items-center gap-1.5 truncate text-foreground">
                                {candidate.name}
                                {candidate.is_home_workspace ? (
                                  <Badge variant="secondary">{t("documents.share.home_badge")}</Badge>
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
