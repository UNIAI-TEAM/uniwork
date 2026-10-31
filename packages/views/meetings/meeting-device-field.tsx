"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Field, FieldDescription, FieldLabel, FieldTitle } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import type { MediaDevice } from "./meeting-media-controls";

// Its own module: the Select primitive is heavy, and the guest invite page
// imports the toggle bar from meeting-media-controls without any picker.
/**
 * Device picker for prejoin screens. Before the browser grants access every
 * device comes back with an empty id, so the list is empty — the field stays
 * and says why instead of vanishing.
 */
export function MeetingDeviceField({
  id,
  label,
  devices,
  value,
  onValueChange,
  emptyDescription,
  emptyAction,
  adornment,
  children,
}: {
  id: string;
  label: string;
  devices: MediaDevice[];
  value: string;
  onValueChange: (deviceId: string) => void;
  emptyDescription: string;
  /** The step that fills the list (asking for permission), shown while it is empty. */
  emptyAction?: ReactNode;
  /** Drawn inside the picker, just before its chevron (the prejoin's mic dots). */
  adornment?: ReactNode;
  /** Extra detail under the picker (an input-level meter). */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (devices.length === 0) {
    return (
      <Field>
        <FieldTitle>{label}</FieldTitle>
        <FieldDescription className="text-caption">{emptyDescription}</FieldDescription>
        {emptyAction}
      </Field>
    );
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {/* The adornment sits over the trigger; the value keeps clear of it. */}
      <div className={adornment ? "relative [&_[data-slot=select-value]]:pr-12" : "contents"}>
        <Select
          id={id}
          value={value || devices[0]!.deviceId}
          onValueChange={(v) => v && onValueChange(v)}
          items={devices.map((d) => ({
            value: d.deviceId,
            label: d.label || t("meetings.deviceUnnamed"),
          }))}
        />
        {adornment ? (
          <span className="pointer-events-none absolute top-1/2 right-7.5 flex -translate-y-1/2 items-center">
            {adornment}
          </span>
        ) : null}
      </div>
      {children}
    </Field>
  );
}
