"use client";
import { Dices } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isReservedSlug } from "@uniwork/core/paths";
import { useCoarsePointer } from "@uniwork/ui/hooks/use-pointer";
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
  // Trên thiết bị cảm ứng, autoFocus bật bàn phím ngay khi vào bước và đẩy tiêu
  // đề + lede ra khỏi màn — user mất luôn phần giải thích bước này là gì.
  const coarsePointer = useCoarsePointer();
  // Enter vẫn phải chặn thủ công: IME tiếng Việt/CJK dùng Enter để chốt chữ,
  // submit native sẽ nuốt mất phím đó.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter();
    }
  };
  return (
    // `<form>` thật, không phải div: bàn phím mobile đổi phím trả về thành "Go",
    // trình quản lý mật khẩu nhận diện đúng, và Enter có ngữ nghĩa gửi ngay cả
    // khi handler onKeyDown phía trên hỏng.
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onEnter();
      }}
    >
      <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>{nameLabel}</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-name`}
            autoFocus={autoFocus && !coarsePointer}
            value={form.name}
            placeholder={namePlaceholder}
            className="h-10 min-w-0 text-body pointer-coarse:h-11"
            disabled={disabled}
            autoComplete="organization"
            enterKeyHint="go"
            spellCheck={false}
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
            "flex h-10 items-center rounded-[var(--uw-radius)] border bg-subtle transition-colors focus-within:border-primary pointer-coarse:h-11 " +
            // `bg-subtle` trên canvas chỉ 1.03:1 — viền là thứ duy nhất vẽ ra
            // hình hài của ô nhập, nên nó phải đạt 3:1 (WCAG 1.4.11).
            (form.slugError ? "border-danger" : "border-line-loud")
          }
        >
          <span className="max-w-[60%] shrink-0 select-none truncate pl-3 font-mono text-body text-secondary" title={hostPrefix}>
            {hostPrefix}
          </span>
          <Input
            id={`${idPrefix}-slug`}
            value={form.slug}
            placeholder={slugPlaceholder}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            enterKeyHint="go"
            aria-describedby={form.slugError ? `${idPrefix}-slug-error` : undefined}
            aria-invalid={form.slugError ? true : undefined}
            className="h-full border-0 bg-transparent font-mono text-body shadow-none focus-visible:outline-none"
            onChange={(e) => form.setSlugValue(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <FieldError id={`${idPrefix}-slug-error`}>{form.slugError}</FieldError>
      </Field>
      {preview && (
        <Field>
          <FieldTitle>{preview.title}</FieldTitle>
          <FieldDescription>{preview.body}</FieldDescription>
        </Field>
      )}
      </FieldGroup>
    </form>
  );
}
