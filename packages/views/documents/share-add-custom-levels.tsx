"use client";

import { useTranslation } from "react-i18next";
import type { DocumentAccessLevel } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import type { SelectedShareCandidate } from "./share-add-section";
import { SharePrincipalIcon } from "./share-candidate-picker";

interface ShareAddCustomLevelsProps {
  selected: SelectedShareCandidate[];
  shelved: boolean;
  summaryText: string;
  onApplyAll: () => void;
  allowedLevels: (item: SelectedShareCandidate) => readonly DocumentAccessLevel[];
  effectiveItemLevel: (item: SelectedShareCandidate) => DocumentAccessLevel;
  levelLabel: (lvl: DocumentAccessLevel | string) => string;
  onChangeLevel: (key: string, level: DocumentAccessLevel) => void;
}

/** The per-person level list the "custom levels" toggle opens under the form. */
export function ShareAddCustomLevels({
  selected,
  shelved,
  summaryText,
  onApplyAll,
  allowedLevels,
  effectiveItemLevel,
  levelLabel,
  onChangeLevel,
}: ShareAddCustomLevelsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="status" className="text-caption font-medium text-muted-foreground">
          {t("documents.share.custom_levels_summary", { summary: summaryText })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onApplyAll}
        >
          {t("documents.share.apply_all_button")}
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {selected.map((item) => {
          const allowed = allowedLevels(item);
          const currentLvl = effectiveItemLevel(item);
          return (
            <li key={item.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-body">
              <span className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                <SharePrincipalIcon principalType={item.candidate.principal_type} />
                <span className="min-w-0 truncate text-foreground" title={item.candidate.name}>{item.candidate.name}</span>
              </span>
              <span className="w-24 shrink-0 truncate text-caption text-muted-foreground">
                {t(`documents.share.principal_${item.candidate.principal_type}`)}
              </span>
              <div className="w-32 shrink-0">
                <Select
                  value={currentLvl}
                  disabled={shelved}
                  items={allowed.map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))}
                  onValueChange={(v) => { if (!shelved) onChangeLevel(item.key, v as DocumentAccessLevel); }}
                >
                  <SelectTrigger className="w-full" aria-label={`${t("documents.share.level_label")} ${item.candidate.name}: ${levelLabel(currentLvl)}`}>
                    <SelectValue className="min-w-0">{levelLabel(currentLvl)}</SelectValue>
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
  );
}
