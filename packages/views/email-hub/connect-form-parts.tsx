"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { CircleAlert, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Input } from "@uniwork/ui/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@uniwork/ui/components/ui/input-group";
import { Label } from "@uniwork/ui/components/ui/label";
import { PasswordInput } from "../common/password-input";

/**
 * A labelled input with its error, else its hint, as the description. A password gets the show/hide toggle; a
 * read-only value (the address of a mailbox being reconnected) reads as fixed.
 */
export function TextField({
  id,
  label,
  error,
  hint,
  ...input
}: { id: string; label: string; error?: string | null; hint?: ReactNode } & ComponentProps<"input">) {
  const noteId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = { id, "aria-invalid": error ? true : undefined, "aria-describedby": noteId, ...input };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {input.type === "password" ? (
        <PasswordInput {...control} />
      ) : input.readOnly ? (
        <InputGroup className="bg-muted pointer-coarse:min-h-11 dark:bg-muted">
          <InputGroupInput {...control} className="text-muted-foreground" />
          <InputGroupAddon align="inline-end">
            <Lock aria-hidden />
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Input {...control} />
      )}
      {error ? (
        <p id={noteId} className="text-caption text-destructive">
          {error}
        </p>
      ) : hint ? (
        <div id={noteId} className="text-caption text-pretty text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/**
 * An error for the whole form. With `focus`, it takes focus as it appears: at the end of a long form it may be out
 * of view, and focus both scrolls it in and reads it out.
 */
export function ErrorAlert({ message, focus = false }: { message: string | null; focus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus && message) ref.current?.focus();
  }, [focus, message]);
  if (!message) return null;
  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1}>
      <CircleAlert aria-hidden />
      <AlertDescription className="text-caption">{message}</AlertDescription>
    </Alert>
  );
}
