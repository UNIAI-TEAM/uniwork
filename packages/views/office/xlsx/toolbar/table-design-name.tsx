"use client";

// The Table Design > Properties "Table name" readout. Excel makes this field
// editable; the gateway has no rename write path (the journal only records a
// table's creation and its cancellation), so it is a read-only field: the name
// is visible and selectable, never a control that would silently not save.
import { useTranslation } from "react-i18next";
import { Input } from "@uniwork/ui/components/ui/input";

export function XlsxTableDesignName({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{t("office.xlsx.table.nameLabel")}</span>
      <Input
        readOnly
        className="h-6 w-32 px-1 text-caption"
        aria-label={t("office.xlsx.table.nameLabel")}
        value={name}
        data-testid="xlsx-table-design-name"
      />
    </div>
  );
}
