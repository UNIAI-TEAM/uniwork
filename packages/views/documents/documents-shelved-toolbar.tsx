"use client";

import { ArrowDownUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { ScopeTabsBar, TypeChipRow, type ScopeTab } from "./documents-library-toolbar";
import type { TypeChip } from "./library-rows";

/** The Select value of the system row (a shelved item whose `shelved_by` is
 *  null — a batch or daemon write, not a member). User ids never collide with
 *  it because ULIDs carry no underscores. */
export const SHELVED_BY_SYSTEM = "__system__";
const SHELVED_BY_ANY = "__any__";

/** One entry of the "Lưu trữ bởi" filter: a workspace member, a former member
 *  the loaded rows still name (id unknown to the member list), or the system
 *  placeholder for rows with `shelved_by: null`. */
export interface ShelvedByOption {
  /** A member id or SHELVED_BY_SYSTEM. */
  value: string;
  label: string;
}

export interface ShelvedToolbarProps {
  scope: ScopeTab | null;
  count: { value: number; more: boolean } | null;
  onScope: (scope: ScopeTab) => void;
  chip: TypeChip;
  onChip: (chip: TypeChip) => void;
  /** The "Lưu trữ bởi" options: members + former members seen on loaded rows + system. */
  shelvedByOptions: ShelvedByOption[];
  /** The active member filter: null (anyone), a user id, or SHELVED_BY_SYSTEM. */
  shelvedBy: string | null;
  onShelvedBy: (value: string | null) => void;
}

/**
 * The toolbar of the Lưu trữ list (Archive.dc, ARCHIVE-01 U-2): the same scope
 * tabs and Loại chips the other views carry, then the member filter — the
 * server has no `shelved_by` parameter, so it narrows only the loaded pages
 * and says so — and the fixed "Lưu trữ gần nhất" sort the server answers with.
 */
export function ShelvedToolbar({ scope, count, onScope, chip, onChip, shelvedByOptions, shelvedBy, onShelvedBy }: ShelvedToolbarProps) {
  const { t } = useTranslation();
  const items = [
    { value: SHELVED_BY_ANY, label: t("documents.shelved_list.filter_by_any") },
    ...shelvedByOptions.map((option) => ({ value: option.value, label: option.label })),
  ];
  const selected = shelvedBy ?? SHELVED_BY_ANY;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ScopeTabsBar scope={scope} count={count} onScope={onScope} />
      <TypeChipRow chip={chip} onChip={onChip} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="documents-shelved-by" className="shrink-0 text-caption text-muted-foreground">
            {t("documents.shelved_list.filter_by_label")}
          </Label>
          <Select
            value={selected}
            onValueChange={(next) => {
              const value = next === SHELVED_BY_ANY ? null : next;
              if (value !== shelvedBy) onShelvedBy(value);
            }}
            items={items}
          >
            <SelectTrigger id="documents-shelved-by" size="sm" variant="subtle" className="w-44" aria-label={t("documents.shelved_list.filter_by_label")}>
              <SelectValue>{items.find((item) => item.value === selected)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {shelvedBy !== null ? (
          <span className="text-caption text-muted-foreground">{t("documents.shelved_list.filter_loaded_only")}</span>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2 text-caption text-muted-foreground">
        <ArrowDownUp aria-hidden className="size-3.5" />
        {t("documents.shelved_list.sort_shelved_desc")}
      </div>
    </div>
  );
}
