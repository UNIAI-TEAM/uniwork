"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import type { PdfPasswordPromptProps } from "./types";

/**
 * The browser-safe prompt for encrypted PDFs. The entered password is held only
 * while the dialog is open — it is cleared on close and never written to
 * storage, a draft, a log or the save payload. Focus lands on the field on
 * open and on every re-prompt, with the refused text selected so typing
 * replaces it.
 */
export function PdfPasswordPrompt({
  open,
  mode = "required",
  pending = false,
  error = null,
  onSubmit,
  onCancel,
}: PdfPasswordPromptProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pdf.password" });
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (!open) {
      setValue("");
      return;
    }
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [open, mode]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    onSubmit(value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <DialogContent showCloseButton={!pending} closeLabel={t("close")}>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          {mode === "wrong" || error !== null ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error ?? t("wrong")}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor={inputId}>{t("label")}</Label>
            <Input
              ref={inputRef}
              id={inputId}
              type="password"
              autoComplete="off"
              disabled={pending}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t("placeholder")}
              aria-invalid={mode === "wrong" || error !== null}
            />
          </div>
          <DialogFooter className="sm:flex-col sm:items-stretch">
            <Button type="submit" disabled={pending}>
              {pending ? t("checking") : t("submit")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              {t("cancel")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
