"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

export type AddablePropertyOption = { key: string; label: string; icon: ReactNode };

/** "+ Add property": lists the fields the sidebar hides until they are set. */
export function TaskAddPropertyMenu({
  options,
  onAdd,
}: {
  options: AddablePropertyOption[];
  onAdd: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (options.length === 0) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-7 w-full justify-start gap-1.5 px-2 text-caption font-normal text-muted-foreground"
          />
        }
      >
        <Plus aria-hidden className="size-3.5" />
        {t("tasks.detail.optional_properties")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {options.map((option) => (
          <DropdownMenuItem key={option.key} onClick={() => onAdd(option.key)}>
            {option.icon}
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
