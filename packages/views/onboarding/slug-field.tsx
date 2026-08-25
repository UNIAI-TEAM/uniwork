"use client";
import { Dices } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isReservedSlug } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { nameToSlug, randomWorkspaceIdentity, SLUG_REGEX } from "../workspace/slug";

/** Enter khi đang gõ IME (tiếng Việt/CJK) không được submit. */
export function isImeComposing(e: KeyboardEvent<HTMLElement>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export function useSlugForm() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const slugTouched = useRef(false); // ref: chỉ là cờ, không cần re-render

  const clientError =
    slug.length > 0 && !SLUG_REGEX.test(slug)
      ? t("onboarding.step_workspace.slug_format_error")
      : slug.length > 0 && isReservedSlug(slug)
        ? t("onboarding.step_workspace.slug_reserved_error")
        : null;
  const slugError = clientError ?? serverError;

  return {
    name,
    slug,
    slugError,
    setServerError,
    canSubmit: name.trim().length > 0 && slug.trim().length > 0 && !slugError,
    setNameValue: (v: string) => {
      setName(v);
      if (!slugTouched.current) {
        setSlug(nameToSlug(v));
        setServerError(null);
      }
    },
    setSlugValue: (v: string) => {
      slugTouched.current = true;
      setSlug(v);
      setServerError(null);
    },
    randomize: () => {
      const id = randomWorkspaceIdentity();
      slugTouched.current = true;
      setName(id.name);
      setSlug(id.slug);
      setServerError(null);
    },
    reset: () => {
      slugTouched.current = false;
      setName("");
      setSlug("");
      setServerError(null);
    },
  };
}
export type SlugForm = ReturnType<typeof useSlugForm>;

/** Hai Field (tên [+ Ngẫu nhiên], pill URL) + lỗi inline + preview tuỳ chọn. */
export function SlugFields({
  idPrefix,
  form,
  hostPrefix,
  nameLabel,
  namePlaceholder,
  urlLabel,
  slugPlaceholder,
  onEnter,
  disabled,
  autoFocus = true,
  withRandom,
  preview,
}: {
  idPrefix: string;
  form: SlugForm;
  hostPrefix: string;
  nameLabel: string;
  namePlaceholder: string;
  urlLabel: string;
  slugPlaceholder: string;
  onEnter: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  withRandom?: boolean;
  preview?: { title: string; body: ReactNode };
}) {
  const { t } = useTranslation();
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter();
    }
  };
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>{nameLabel}</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-name`}
            autoFocus={autoFocus}
            value={form.name}
            placeholder={namePlaceholder}
            className="h-10 min-w-0 text-body"
            disabled={disabled}
            onChange={(e) => form.setNameValue(e.target.value)}
            onKeyDown={onKey}
          />
          {withRandom && (
            <Button type="button" variant="outline" size="lg" className="shrink-0" onClick={form.randomize} disabled={disabled}>
              <Dices className="size-4" />
              {t("onboarding.step_workspace.random_name")}
            </Button>
          )}
        </div>
      </Field>
      <Field data-invalid={form.slugError ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-slug`}>{urlLabel}</FieldLabel>
        <div
          className={
            "flex h-10 items-center rounded-[var(--uw-radius)] border bg-subtle transition-colors focus-within:border-primary " +
            (form.slugError ? "border-danger" : "border-line")
          }
        >
          <span className="select-none pl-3 font-mono text-body text-secondary">{hostPrefix}</span>
          <Input
            id={`${idPrefix}-slug`}
            value={form.slug}
            placeholder={slugPlaceholder}
            disabled={disabled}
            className="h-full border-0 bg-transparent font-mono text-body shadow-none focus-visible:outline-none"
            onChange={(e) => form.setSlugValue(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <FieldError>{form.slugError}</FieldError>
      </Field>
      {preview && (
        <Field>
          <FieldTitle>{preview.title}</FieldTitle>
          <FieldDescription>{preview.body}</FieldDescription>
        </Field>
      )}
    </FieldGroup>
  );
}
