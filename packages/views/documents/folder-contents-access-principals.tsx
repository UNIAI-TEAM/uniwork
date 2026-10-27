"use client";

import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentAccessRejectedCode } from "@uniwork/core/api/endpoints/documents-sharing";
import type { DocumentAccessLevel } from "@uniwork/core/types/document";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { allowedLevelsForPrincipal } from "./share-add-section";
import { SharePrincipalIcon } from "./share-candidate-picker";
import {
  effectiveLevel,
  WORKSPACE_ROW_LEVELS,
  type PickedPrincipal,
  type WorkspaceRowChoice,
  type WorkspaceRowLevel,
} from "./folder-contents-access-model";

/** The share dialog's names for the four access levels. */
export function useAccessLevelLabel(): (level: DocumentAccessLevel | string) => string {
  const { t } = useTranslation();
  return (level) =>
    level === "manage" ? t("documents.share.level_manage")
    : level === "edit" ? t("documents.share.level_edit")
    : level === "comment" ? t("documents.share.level_comment")
    : t("documents.share.level_view");
}

const ROW_CLASS = "flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-body";
const NAME_CLASS = "flex min-w-0 flex-1 basis-40 flex-col gap-0.5";

/**
 * The principals of the folder contents access dialog, each with its own level
 * (no remove level: merge never takes access away and replace removes whoever is
 * not listed). In replace mode the workspace root row is always the first row;
 * `Riêng tư` leaves it out, which makes the documents Private.
 */
export function FolderAccessPrincipals({
  mode,
  picked,
  workspaceName,
  workspaceLevel,
  rejectedByKey,
  disabled,
  onLevel,
  onRemove,
  onWorkspaceLevel,
}: {
  mode: "merge" | "replace";
  picked: readonly PickedPrincipal[];
  workspaceName: string;
  workspaceLevel: WorkspaceRowChoice;
  rejectedByKey: Record<string, DocumentAccessRejectedCode>;
  disabled: boolean;
  onLevel: (key: string, level: DocumentAccessLevel) => void;
  onRemove: (key: string, name: string) => void;
  onWorkspaceLevel: (level: WorkspaceRowLevel) => void;
}) {
  const { t } = useTranslation();
  const levelLabel = useAccessLevelLabel();
  const workspaceLabel = (level: WorkspaceRowLevel) =>
    level === "none" ? t("documents.folderAccess.level_private") : levelLabel(level);
  const rejectedLabel = (code: DocumentAccessRejectedCode) =>
    code === "principal_not_in_organization" ? t("documents.share.rejected_not_in_org")
    : code === "level_not_allowed" ? t("documents.share.rejected_level_not_allowed")
    : code === "duplicate_principal" ? t("documents.share.rejected_duplicate")
    : code === "break_glass_required" ? t("documents.share.rejected_break_glass")
    : t("documents.share.rejected_unknown");

  return (
    <ul aria-label={t("documents.folderAccess.principals_title")} className="flex min-w-0 flex-col gap-2">
      {mode === "replace" ? (
        <li className={`${ROW_CLASS} border-border bg-muted/50`} data-testid="folder-access-workspace-row">
          <span className={NAME_CLASS}>
            <span className="flex min-w-0 items-center gap-2 text-foreground">
              <SharePrincipalIcon principalType="workspace" />
              <span className="min-w-0 truncate" title={workspaceName}>{workspaceName}</span>
              <Badge variant="secondary" className="shrink-0">{t("documents.share.home_badge")}</Badge>
            </span>
          </span>
          <Select
            value={workspaceLevel}
            disabled={disabled}
            items={WORKSPACE_ROW_LEVELS.map((level) => ({ value: level, label: workspaceLabel(level) }))}
            onValueChange={(value) => onWorkspaceLevel(value as WorkspaceRowLevel)}
          >
            <SelectTrigger data-testid="folder-access-workspace-level" aria-label={t("documents.folderAccess.workspace_level_label")} className="w-fit min-w-36 max-w-full">
              <SelectValue className="min-w-0" placeholder={t("documents.folderAccess.workspace_level_choose")}>
                {workspaceLevel === null ? undefined : workspaceLabel(workspaceLevel)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {WORKSPACE_ROW_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>{workspaceLabel(level)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </li>
      ) : null}
      {picked.map((item) => {
        const { candidate } = item;
        const rejected = rejectedByKey[item.key];
        const allowed = allowedLevelsForPrincipal(candidate.principal_type, candidate.is_home_workspace);
        const level = effectiveLevel(item);
        return (
          <li
            key={item.key}
            data-testid={`folder-access-principal-${candidate.principal_id}`}
            className={`${ROW_CLASS} ${rejected ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-muted/50 text-foreground"}`}
          >
            <span className={NAME_CLASS}>
              <span className="flex min-w-0 items-center gap-2">
                <SharePrincipalIcon principalType={candidate.principal_type} className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate" title={candidate.name}>{candidate.name}</span>
                {candidate.is_home_workspace ? <Badge variant="secondary" className="shrink-0">{t("documents.share.home_badge")}</Badge> : null}
              </span>
              {rejected ? (
                <span className="text-caption font-medium" data-testid={`rejected-reason-${candidate.principal_id}`}>
                  {rejectedLabel(rejected)}
                </span>
              ) : null}
            </span>
            <Select
              value={level}
              disabled={disabled}
              items={allowed.map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))}
              onValueChange={(value) => onLevel(item.key, value as DocumentAccessLevel)}
            >
              <SelectTrigger aria-label={t("documents.share.level_for", { name: candidate.name })} className="w-36 max-w-full">
                <SelectValue className="min-w-0">{levelLabel(level)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {allowed.map((lvl) => (
                  <SelectItem key={lvl} value={lvl}>{levelLabel(lvl)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={t("documents.share.people_remove", { name: candidate.name })}
              onClick={() => onRemove(item.key, candidate.name)}
            >
              <X aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
