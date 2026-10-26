"use client";

import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TrashKind } from "@uniwork/core/trash";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";

/** Empty strings mean "no filter": the endpoint leaves them off the URL. */
export interface TrashFilterValues {
  q: string;
  kind: TrashKind | "";
  trashedBy: string;
}

export const EMPTY_TRASH_FILTERS: TrashFilterValues = { q: "", kind: "", trashedBy: "" };

/** One row above the trash: name search, kind and deleter. Each applies as it changes. */
export function TrashFilters({
  filters,
  onChange,
  members,
  meId,
  documentsEnabled,
}: {
  filters: TrashFilterValues;
  onChange: (next: TrashFilterValues) => void;
  members: readonly { user_id: string; display_name: string }[];
  meId: string;
  /** Off, the kind filter has no Tài liệu: the server lists no documents then. */
  documentsEnabled: boolean;
}) {
  const { t } = useTranslation();
  const kinds = [
    { value: "", label: t("trash.kind_all") },
    { value: "task", label: t("trash.kinds.task") },
    { value: "project", label: t("trash.kinds.project") },
    ...(documentsEnabled ? [{ value: "document", label: t("trash.kinds.document") }] : []),
  ];
  const people = [
    { value: "", label: t("trash.trashed_by_anyone") },
    { value: meId, label: t("trash.trashed_by_me") },
    ...members.filter((m) => m.user_id !== meId).map((m) => ({ value: m.user_id, label: m.display_name })),
  ];

  return (
    <div role="search" aria-label={t("trash.filters_label")} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-64">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={t("trash.search")}
          placeholder={t("trash.search")}
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          className="pl-8"
        />
      </div>
      <div className="sm:w-44">
        <Select
          aria-label={t("trash.kind_label")}
          items={kinds}
          value={filters.kind}
          onValueChange={(value) => onChange({ ...filters, kind: (value ?? "") as TrashFilterValues["kind"] })}
        />
      </div>
      <div className="sm:w-52">
        <Select
          aria-label={t("trash.trashed_by_label")}
          items={people}
          value={filters.trashedBy}
          onValueChange={(value) => onChange({ ...filters, trashedBy: value ?? "" })}
        />
      </div>
    </div>
  );
}
