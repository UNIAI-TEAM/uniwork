"use client";

import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@uniwork/ui/components/ui/input";

/** Name filter of the Drive list; it filters the node (account or folder) the screen is showing. */
export function DriveLibrarySearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative w-full sm:w-64">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={t("driveLibrary.list.search_label")}
        placeholder={t("driveLibrary.list.search_placeholder")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-8"
      />
    </div>
  );
}
