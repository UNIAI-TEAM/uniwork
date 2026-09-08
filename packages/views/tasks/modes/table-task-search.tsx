"use client";

import { Search, X } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";

export function TableTaskSearch({
  value,
  onChange,
  placeholder,
  clearLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex min-w-0 flex-1 items-center", className)}>
      <Search
        className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8 pr-8"
        aria-label={placeholder}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 size-6"
          aria-label={clearLabel}
          onClick={() => onChange("")}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
