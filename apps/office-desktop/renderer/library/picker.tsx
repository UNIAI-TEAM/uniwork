import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import type { DesktopLibraryContextResponse } from "../../shared/ipc";

export type PickerGroup = keyof DesktopLibraryContextResponse;
const GROUPS: readonly PickerGroup[] = ["deployments", "accounts", "organizations", "workspaces"];

export interface LibraryPickerSelection {
  deploymentId: string;
  accountId: string;
  organizationId: string;
  workspaceId: string;
}

export interface LibraryPickerProps {
  context: DesktopLibraryContextResponse | null;
  error?: boolean;
  onRetry?: () => void;
  onChoose: (selection: LibraryPickerSelection) => void;
}

const GROUP_TO_KEY: Record<PickerGroup, keyof LibraryPickerSelection> = {
  deployments: "deploymentId",
  accounts: "accountId",
  organizations: "organizationId",
  workspaces: "workspaceId",
};

/** The scope the brief requires before any library query runs: deployment,
 * account, organization, then workspace. Nothing here guesses a default --
 * metadata from a previous account never flashes through this screen. */
export function LibraryPicker({ context, error = false, onRetry, onChoose }: LibraryPickerProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [selected, setSelected] = useState<Partial<LibraryPickerSelection>>({});
  useEffect(() => {
    if (!context) return;
    const defaults: Partial<LibraryPickerSelection> = {};
    GROUPS.forEach((group) => {
      const entries = context[group] ?? [];
      if (entries.length === 1) defaults[GROUP_TO_KEY[group]] = entries[0]!.id;
    });
    setSelected(defaults);
  }, [context]);
  const ready = GROUPS.every((group) => Boolean(selected[GROUP_TO_KEY[group]]));
  const missing = GROUPS.filter((group) => !selected[GROUP_TO_KEY[group]]);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto p-6" data-desktop-library-picker="true">
      <div className="flex w-full max-w-2xl flex-col gap-6">
      <h1 className="text-title font-semibold text-foreground">{t("pickerTitle")}</h1>
      {error ? (
        <div className="flex flex-col gap-3" role="alert">
          <p className="text-body text-muted-foreground">{t("contextError")}</p>
          <Button type="button" variant="outline" onClick={onRetry}>{t("retry")}</Button>
        </div>
      ) : !context ? (
        <Skeleton className="h-40 w-full max-w-md" />
      ) : (
        <>
          {GROUPS.map((group) => {
            const key = GROUP_TO_KEY[group];
            return (
              <section key={group} className="flex flex-col gap-2">
                <h2 className="text-label font-medium text-muted-foreground">{t(group)}</h2>
                <RadioGroup value={selected[key] ?? ""} onValueChange={(value) => setSelected((previous) => ({ ...previous, [key]: value }))} aria-label={t(group)} className="grid gap-2 sm:grid-cols-2">
                  {(context[group] ?? []).map((entry) => <label key={entry.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground"><RadioGroupItem value={entry.id} data-picker-kind={group} data-picker-id={entry.id} /> <span className="break-words">{entry.name}</span></label>)}
                </RadioGroup>
              </section>
            );
          })}
          <Button
            type="button"
            disabled={!ready}
            onClick={() => ready && onChoose(selected as LibraryPickerSelection)}
          >
            {t("pickerChoose")}
          </Button>
          {!ready ? <p role="status" className="text-caption text-muted-foreground">{t("pickerRequired", { groups: missing.map((group) => t(group)).join(", ") })}</p> : null}
        </>
      )}
      </div>
    </div>
  );
}
