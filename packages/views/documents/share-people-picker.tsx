"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import { sharePrincipalsNotInOrganization } from "@uniwork/core/documents/errors";
import { useShareDocumentBatch } from "@uniwork/core/documents/hooks-sharing";
import type { DocumentAccessLevel, DocumentShare } from "@uniwork/core/types/document";
import type { OrgMember } from "@uniwork/core/types/people";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@uniwork/ui/components/ui/combobox";

/** The server refuses a batch above this many distinct people (UNI-1641). */
export const SHARE_PEOPLE_MAX = 50;

interface PersonOption {
  id: string;
  name: string;
  email: string;
}

/** Case- and diacritic-insensitive, so "binh" finds "Bình" and "dung" "Dũng". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/**
 * Batch submit for the people picker: one POST for every picked person at one
 * level, all or nothing. A 422 principal_not_in_organization names the
 * refused people (member name, else the id) and keeps the selection so they
 * can be removed; success clears it. Errors go to the dialog's own slot.
 */
export function useSharePeople(
  wsId: string,
  documentId: string,
  nameOf: (userId: string) => string,
  setError: (message: string | null) => void,
) {
  const { t } = useTranslation();
  const batch = useShareDocumentBatch(wsId, documentId);
  const [ids, setIds] = useState<string[]>([]);

  const change = (next: string[]) => {
    setIds(next.slice(0, SHARE_PEOPLE_MAX));
    setError(null);
  };

  const submit = async (level: DocumentAccessLevel) => {
    if (!ids.length || batch.isPending) return;
    setError(null);
    try {
      await batch.mutateAsync({ principal_ids: ids, level });
      setIds([]);
    } catch (err) {
      const refused = sharePrincipalsNotInOrganization(err);
      setError(
        refused?.length
          ? t("documents.share.people_not_in_org", {
              count: refused.length,
              names: refused.map(nameOf).join(", "),
            })
          : apiErrorMessage(err) ?? t("documents.share.submit_failed"),
      );
    }
  };

  return { ids, change, submit, isPending: batch.isPending };
}

/**
 * Searchable multi-select of the organization's members for a batch share.
 * Picked people sit below the field as removable chips; the list keeps
 * people who already hold a grant selectable (the server replaces their
 * level) and marks them. At the cap every unpicked row is disabled and the
 * field says why.
 */
export function SharePeoplePicker({
  id,
  members,
  shares,
  people,
}: {
  id: string;
  members: readonly OrgMember[];
  /** The document's grants; live person grants are marked in the list. */
  shares: readonly Pick<DocumentShare, "principal_type" | "principal_id" | "active">[];
  people: ReturnType<typeof useSharePeople>;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const { ids: value, change: onChange, isPending: disabled } = people;
  const sharedIds = useMemo(
    () => new Set(shares.filter((r) => r.principal_type === "user" && r.active).map((r) => r.principal_id)),
    [shares],
  );

  const options = useMemo<PersonOption[]>(
    () => members.map((m) => ({ id: m.user_id, name: m.display_name || m.email, email: m.email })),
    [members],
  );
  const selected = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    return value.map((pid) => byId.get(pid) ?? { id: pid, name: pid, email: "" });
  }, [options, value]);
  const atCap = value.length >= SHARE_PEOPLE_MAX;
  const hintId = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <Combobox
        multiple
        items={options}
        value={selected}
        inputValue={input}
        onInputValueChange={(text) => setInput(text)}
        itemToStringLabel={(o: PersonOption) => o.name}
        itemToStringValue={(o: PersonOption) => o.id}
        isItemEqualToValue={(a: PersonOption, b: PersonOption) => a.id === b.id}
        filter={(o: PersonOption, query: string) =>
          fold(`${o.name} ${o.email}`).includes(fold(query.trim()))
        }
        onValueChange={(next: PersonOption[]) => {
          onChange(next.map((o) => o.id));
          setInput("");
        }}
        disabled={disabled}
      >
        <ComboboxInput
          id={id}
          className="w-full"
          placeholder={t("documents.share.people_placeholder")}
          aria-describedby={hintId}
          disabled={disabled}
        />
        <ComboboxContent>
          <ComboboxEmpty>{t("documents.share.people_empty")}</ComboboxEmpty>
          <ComboboxList>
            {(o: PersonOption) => (
              <ComboboxItem
                key={o.id}
                value={o}
                disabled={atCap && !value.includes(o.id)}
              >
                <span className="min-w-0 truncate">{o.name}</span>
                <span className="ml-auto truncate pl-2 text-caption text-muted-foreground">
                  {sharedIds.has(o.id) ? t("documents.share.people_already_shared") : o.email}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p id={hintId} role="status" className="text-caption text-muted-foreground">
        {atCap
          ? t("documents.share.people_limit", { max: SHARE_PEOPLE_MAX })
          : t("documents.share.people_selected", { count: value.length })}
      </p>
      {selected.length ? (
        <ul aria-label={t("documents.share.people_chosen")} className="flex flex-wrap gap-1">
          {selected.map((o) => (
            <li key={o.id}>
              <Badge variant="secondary" className="h-6 gap-0.5 pr-0.5">
                <span className="max-w-40 truncate">{o.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("documents.share.people_remove", { name: o.name })}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((pid) => pid !== o.id))}
                >
                  <X aria-hidden className="size-3" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
