"use client";

import { useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@uniwork/ui/components/ui/combobox";

/** One person the picker can offer. `email` is searched and shown under the name. */
export interface PersonOption {
  id: string;
  name: string;
  email: string;
}

/** Case- and diacritic-insensitive, so "chi" finds "Chí". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/**
 * The one "pick a member" control behind both ownership transfers (a document's
 * owner, a deactivated member's documents): a searchable combobox with a
 * diacritic-folding filter. `pinned` is an extra choice that is not a person
 * ("Để sau") and stays listed whatever is typed.
 */
export function PersonCombobox({
  id,
  options,
  pinned,
  value,
  onValueChange,
  placeholder,
  emptyLabel,
  disabled = false,
}: {
  id: string;
  options: readonly PersonOption[];
  pinned?: PersonOption;
  value: PersonOption | null;
  onValueChange: (next: PersonOption | null) => void;
  placeholder: string;
  /** Shown when nothing matches: "no one to pick" or "still loading". */
  emptyLabel: string;
  disabled?: boolean;
}) {
  const [input, setInput] = useState(value?.name ?? "");
  const items = pinned ? [...options, pinned] : [...options];
  return (
    <Combobox
      items={items}
      value={value}
      inputValue={input}
      onInputValueChange={(text) => setInput(text)}
      itemToStringLabel={(o: PersonOption) => o.name}
      itemToStringValue={(o: PersonOption) => o.id}
      isItemEqualToValue={(a: PersonOption, b: PersonOption) => a.id === b.id}
      filter={(o: PersonOption, query: string) =>
        o.id === pinned?.id || fold(`${o.name} ${o.email}`).includes(fold(query.trim()))
      }
      onValueChange={(next: PersonOption | null) => {
        setInput(next?.name ?? "");
        onValueChange(next);
      }}
      disabled={disabled}
    >
      <ComboboxInput id={id} className="w-full" placeholder={placeholder} disabled={disabled} />
      <ComboboxContent>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(o: PersonOption) => (
            <ComboboxItem key={o.id} value={o}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-words">{o.name}</span>
                {o.email ? <span className="truncate text-caption text-muted-foreground">{o.email}</span> : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
