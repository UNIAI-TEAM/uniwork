"use client";

import { useTranslation } from "react-i18next";
import { FilterSelect, LibraryToolbar, type LibraryToolbarProps } from "./documents-library-toolbar";

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

export interface ShelvedToolbarProps extends Omit<LibraryToolbarProps, "activity" | "onActivity" | "children" | "note" | "className"> {
  /** The "Lưu trữ bởi" options: members + former members seen on loaded rows + system. */
  shelvedByOptions: ShelvedByOption[];
  /** The active member filter: null (anyone), a user id, or SHELVED_BY_SYSTEM. */
  shelvedBy: string | null;
  onShelvedBy: (value: string | null) => void;
}

/**
 * The toolbar of the Lưu trữ list (Archive.dc, ARCHIVE-01 U-2): the filter
 * bar every list screen carries (UNI-2045 W10), then the "Lưu trữ bởi" member
 * filter as a chip of the same FilterSelect as Người sửa — the server has no
 * `shelved_by` parameter and SV-8's `updated_by` is the last editor, not who
 * shelved the item, so it narrows only the loaded pages and says so in a note
 * under the chips while it is active. The sort is the table headers' (UNI-2045 W12).
 */
export function ShelvedToolbar({ shelvedByOptions, shelvedBy, onShelvedBy, ...bar }: ShelvedToolbarProps) {
  const { t } = useTranslation();
  const items = [
    { value: SHELVED_BY_ANY, label: t("documents.shelved_list.filter_by_any") },
    ...shelvedByOptions.map((option) => ({ value: option.value, label: option.label })),
  ];
  return (
    <LibraryToolbar
      {...bar}
      note={shelvedBy !== null ? <span className="text-caption text-muted-foreground">{t("documents.shelved_list.filter_loaded_only")}</span> : undefined}
    >
      <FilterSelect
        label={t("documents.shelved_list.filter_by_label")}
        value={shelvedBy ?? SHELVED_BY_ANY}
        items={items}
        onPick={(next) => onShelvedBy(next === SHELVED_BY_ANY ? null : next)}
      />
    </LibraryToolbar>
  );
}
