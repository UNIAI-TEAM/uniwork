"use client";

import { Label } from "@uniwork/ui/components/ui/label";
import { Switch } from "@uniwork/ui/components/ui/switch";

/**
 * "Pin to top" for the note, post and poll dialogs. When the viewer may not
 * pin, the control stays visible but off, and the caption says why — the
 * server refuses the pin anyway, so the switch never pretends otherwise.
 */
export function PinToTopRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabledReason,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabledReason?: string;
}) {
  const labelId = `${id}-label`;
  const reasonId = `${id}-reason`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <Label id={labelId} htmlFor={id} className="font-normal text-body text-foreground">
          {label}
        </Label>
        <Switch
          id={id}
          aria-labelledby={labelId}
          aria-describedby={disabledReason ? reasonId : undefined}
          checked={checked && !disabledReason}
          disabled={Boolean(disabledReason)}
          onCheckedChange={onCheckedChange}
        />
      </div>
      {disabledReason ? (
        <p id={reasonId} className="text-caption text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
