"use client";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";

export function MemberMultiPicker({
  workspaceId,
  value,
  onChange,
  excludeUserIds = [],
}: {
  workspaceId: string;
  value: string[];
  onChange: (next: string[]) => void;
  excludeUserIds?: string[];
}) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const options = (members ?? []).filter((m) => !excludeUserIds.includes(m.user_id));

  return (
    <ul className="max-h-48 space-y-1 overflow-auto rounded-lg border border-border bg-surface p-2">
      {options.length === 0 ? (
        <li className="px-2 py-1.5 text-label text-muted-foreground">{t("common.empty")}</li>
      ) : (
        options.map((m) => {
          const checked = value.includes(m.user_id);
          return (
            <li key={m.user_id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => {
                    onChange(next ? [...value, m.user_id] : value.filter((id) => id !== m.user_id));
                  }}
                />
                <span className="min-w-0 truncate text-body text-foreground">{m.display_name}</span>
              </label>
            </li>
          );
        })
      )}
    </ul>
  );
}
